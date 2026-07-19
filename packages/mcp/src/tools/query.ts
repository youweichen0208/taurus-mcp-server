import { z } from "zod";
import { ErrorCode, formatBlocked, formatConfirmationRequired, formatError, formatSuccess, type ToolResponse } from "../utils/formatter.js";
import { formatToolError } from "./error-handling.js";
import type { ToolDefinition, ToolInvokeContext } from "./registry.js";
import {
  asOptionalString,
  asRequiredString,
  contextInputShape,
  metadata,
  resolveContext,
  statementTypeFromSql,
  summarizeRows,
  toPublicExplainResult,
  toPublicGuardrailDecision,
  toPublicQueryResult,
} from "./common.js";
import { createSqlParser, type GuardrailDecision, type SessionContext, type SqlAst, type TableSchema } from "taurusdb-core";

function blockedReason(decision: GuardrailDecision): string {
  return decision.riskHints[0] ?? "The SQL statement is blocked by safety policy.";
}

async function inspectSql(
  toolName: "execute_readonly_sql" | "explain_sql",
  sql: string,
  ctx: SessionContext,
  deps: Parameters<ToolDefinition["handler"]>[1],
): Promise<GuardrailDecision> {
  return deps.engine.inspectSql({
    toolName,
    sql,
    context: ctx,
  });
}

async function ensureConfirmation(
  decision: GuardrailDecision,
  ctx: SessionContext,
  deps: Parameters<ToolDefinition["handler"]>[1],
  invokeContext: ToolInvokeContext,
  approvalToken: string | undefined,
): Promise<ToolResponse | undefined> {
  if (!decision.requiresConfirmation) {
    return undefined;
  }

  const responseMetadata = metadata(invokeContext.taskId, {
    sql_hash: decision.sqlHash,
    statement_type: statementTypeFromSql(decision.normalizedSql),
  });

  if (approvalToken) {
    const validation = await deps.engine.validateConfirmation(
      approvalToken,
      decision.normalizedSql,
      ctx,
    );
    if (validation.valid) {
      invokeContext.approvalActor = validation.actor;
      return undefined;
    }
    return formatError({
      code: ErrorCode.CONFIRMATION_INVALID,
      message: validation.reason ?? "Approval token validation failed.",
      summary: "The provided external approval is invalid for this SQL statement.",
      metadata: responseMetadata,
      details: {
        reason_codes: validation.reasonCodes,
        risk_hints: validation.riskHints,
      },
    });
  }

  const outcome = await deps.engine.handleConfirmation(decision, ctx);
  if (outcome.status === "approval_required") {
    return formatConfirmationRequired({
      approvalRequest: outcome.request,
      requestId: outcome.requestId,
      metadata: responseMetadata,
      riskLevel: decision.riskLevel,
      sqlHash: decision.sqlHash,
    });
  }

  return undefined;
}

export const executeReadonlySqlTool: ToolDefinition = {
  name: "execute_readonly_sql",
  description: "Execute readonly SQL such as SELECT, SHOW, EXPLAIN, or DESCRIBE with guardrail enforcement.",
  inputSchema: {
    ...contextInputShape,
    sql: requiredSqlSchema("Readonly SQL to execute."),
    approval_token: optionalTokenSchema(),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    const sql = asRequiredString(input.sql, "sql");
    const statementType = statementTypeFromSql(sql);

    try {
      const ctx = await resolveContext(input, deps, context, true);
      const decision = await inspectSql("execute_readonly_sql", sql, ctx, deps);
      const baseMetadata = metadata(context.taskId, {
        sql_hash: decision.sqlHash,
        statement_type: statementType,
      });

      if (decision.action === "block") {
        return formatBlocked({
          reason: blockedReason(decision),
          metadata: baseMetadata,
          details: {
            risk_level: decision.riskLevel,
            reason_codes: decision.reasonCodes,
            risk_hints: decision.riskHints,
          },
        });
      }

      const confirmationResponse = await ensureConfirmation(
        decision,
        ctx,
        deps,
        context,
        asOptionalString(input.approval_token, "approval_token"),
      );
      if (confirmationResponse) {
        return confirmationResponse;
      }

      const result = await deps.engine.executeReadonly(decision.normalizedSql, ctx, {
        timeoutMs: decision.runtimeLimits.timeoutMs,
        maxRows: decision.runtimeLimits.maxRows,
        maxColumns: decision.runtimeLimits.maxColumns,
        maxFieldChars: decision.runtimeLimits.maxFieldChars,
        maxResultBytes: decision.runtimeLimits.maxResultBytes,
        maxBlobBytes: decision.runtimeLimits.maxBlobBytes,
        maskAllColumns: decision.runtimeLimits.maskAllColumns,
      });

      return formatSuccess(
        toPublicQueryResult(result),
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            sql_hash: decision.sqlHash,
            statement_type: statementType,
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "execute_readonly_sql",
        metadata: metadata(context.taskId, {
          statement_type: statementType,
        }),
      });
    }
  },
};

export const explainSqlTool: ToolDefinition = {
  name: "explain_sql",
  description: "Run EXPLAIN for a SQL statement and return plan analysis together with guardrail hints.",
  inputSchema: {
    ...contextInputShape,
    sql: requiredSqlSchema("SQL statement to analyze with EXPLAIN."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    const sql = asRequiredString(input.sql, "sql");
    const statementType = statementTypeFromSql(sql);

    try {
      const ctx = await resolveContext(input, deps, context, true);
      const decision = await inspectSql("explain_sql", sql, ctx, deps);
      const baseMetadata = metadata(context.taskId, {
        sql_hash: decision.sqlHash,
        statement_type: statementType,
      });

      if (decision.action === "block") {
        return formatBlocked({
          reason: blockedReason(decision),
          metadata: baseMetadata,
          details: {
            risk_level: decision.riskLevel,
            reason_codes: decision.reasonCodes,
            risk_hints: decision.riskHints,
          },
        });
      }

      const result = await deps.engine.explain(decision.normalizedSql, ctx);
      return formatSuccess(
        toPublicExplainResult(result, decision),
        {
          summary:
            decision.requiresConfirmation
              ? "Explain generated. Executing this SQL would require explicit confirmation."
              : "Explain generated.",
          metadata: metadata(context.taskId, {
            sql_hash: decision.sqlHash,
            statement_type: statementType,
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "explain_sql",
        metadata: metadata(context.taskId, {
          statement_type: statementType,
        }),
      });
    }
  },
};

type SqlAdviceFinding = {
  table?: string;
  finding: string;
  evidence?: Record<string, unknown>;
};

function topLevelKeyword(sql: string, keyword: string, start = 0): number {
  const upperKeyword = keyword.toUpperCase();
  let quote: "'" | '"' | "`" | undefined;
  let depth = 0;
  for (let index = start; index <= sql.length - upperKeyword.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const candidate = sql.slice(index, index + upperKeyword.length).toUpperCase();
    const before = index === 0 ? " " : sql[index - 1];
    const after = sql[index + upperKeyword.length] ?? " ";
    if (candidate === upperKeyword && /\s/.test(before) && /\s/.test(after)) return index;
  }
  return -1;
}

function buildImpactCountSql(sql: string, ast: SqlAst): string | undefined {
  if (!ast.where || ast.tables.length !== 1 || ast.hasSubquery || (ast.joins?.length ?? 0) > 0) return undefined;
  const normalized = sql.replace(/;\s*$/, "").trim();
  const whereIndex = topLevelKeyword(` ${normalized}`, "WHERE") - 1;
  if (whereIndex < 0) return undefined;
  let end = normalized.length;
  for (const keyword of ["ORDER BY", "LIMIT"]) {
    const found = topLevelKeyword(` ${normalized}`, keyword, whereIndex + 2) - 1;
    if (found >= 0) end = Math.min(end, found);
  }
  const predicate = normalized.slice(whereIndex + "WHERE".length, end).trim();
  if (!predicate) return undefined;
  if (ast.kind === "update") {
    const setIndex = topLevelKeyword(` ${normalized}`, "SET") - 1;
    if (setIndex <= "UPDATE".length || setIndex >= whereIndex) return undefined;
    const target = normalized.slice("UPDATE".length, setIndex).trim();
    if (!target || /\bJOIN\b|,/i.test(target)) return undefined;
    return `SELECT COUNT(*) AS matched_row_count FROM ${target} WHERE ${predicate}`;
  }
  if (ast.kind === "delete") {
    const fromIndex = topLevelKeyword(` ${normalized}`, "FROM") - 1;
    if (fromIndex < 0 || fromIndex >= whereIndex) return undefined;
    const target = normalized.slice(fromIndex + "FROM".length, whereIndex).trim();
    if (!target || /\bJOIN\b|,/i.test(target)) return undefined;
    return `SELECT COUNT(*) AS matched_row_count FROM ${target} WHERE ${predicate}`;
  }
  return undefined;
}

function readMatchedRowCount(rows: unknown[][]): number | string | undefined {
  const value = rows[0]?.[0];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function schemaFinding(schema: TableSchema): SqlAdviceFinding {
  return {
    table: `${schema.database}.${schema.table}`,
    finding: `Schema verified: ${schema.columns.length} columns and ${schema.indexes.length} indexes are currently visible.`,
    evidence: {
      columns: schema.columns.map((column) => ({ name: column.name, data_type: column.dataType, nullable: column.nullable })),
      indexes: schema.indexes.map((index) => ({ name: index.name, columns: index.columns, unique: index.unique })),
      row_count_estimate: schema.rowCountEstimate,
    },
  };
}

function createIndexTarget(sql: string): { name: string; schema?: string } | undefined {
  const identifier = "(?:`[^`]+`|[A-Za-z_$][A-Za-z0-9_$-]*)";
  const match = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${identifier}\\s+ON\\s+(${identifier}(?:\\.${identifier})?)`, "i").exec(sql);
  if (!match) return undefined;
  const parts = match[1].split(".").map((part) => part.replace(/^`|`$/g, ""));
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { name: parts[0] };
}

export const analyzeMutationSqlTool: ToolDefinition = {
  name: "analyze_mutation_sql",
  description: "Analyze mutation SQL against readonly schema and plan evidence. The SQL is never executed and human execution is always required.",
  inputSchema: {
    ...contextInputShape,
    sql: requiredSqlSchema("Mutation SQL to analyze without executing it."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    const sql = asRequiredString(input.sql, "sql");
    const statementType = statementTypeFromSql(sql);

    try {
      const ctx = await resolveContext(input, deps, context, true);
      const parser = createSqlParser(ctx.engine);
      const normalized = parser.normalize(sql);
      const parsed = parser.parse(normalized.normalizedSql);
      const schemaFindings: SqlAdviceFinding[] = [];
      const planFindings: SqlAdviceFinding[] = [];
      const indexRecommendations: SqlAdviceFinding[] = [];
      const riskFindings: string[] = ["The MCP did not execute this SQL. Human review and execution are required."];
      const assumptions: string[] = [];
      const unverifiedBusinessRules = ["Business invariants, authorization rules, and application-side effects cannot be verified from database metadata alone."];
      let advisedSql: string | null = null;
      let matchedRowCount: number | string | null = null;
      let fullScanLikely: boolean | null = null;

      if (!parsed.ok || parsed.isMultiStatement) {
        riskFindings.push(parsed.ok ? "Multiple statements are not eligible for copy-ready advice." : `SQL could not be parsed safely: ${parsed.error.message}`);
      } else {
        const ast = parsed.ast;
        const isCreateIndex = ast.kind === "create" && /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(normalized.normalizedSql);
        const indexTarget = isCreateIndex ? createIndexTarget(normalized.normalizedSql) : undefined;
        const adviceTables = indexTarget ? [indexTarget] : ast.tables;
        const supported = ["insert", "update", "delete"].includes(ast.kind) || isCreateIndex;
        const unsafeUnbounded = (ast.kind === "update" || ast.kind === "delete") && !ast.where;
        const complexMutation = ["insert", "update", "delete"].includes(ast.kind) && (adviceTables.length !== 1 || ast.hasSubquery || (ast.joins?.length ?? 0) > 0);
        const scopeViolation = Boolean(ctx.database && adviceTables.some((table) => table.schema && table.schema.toLowerCase() !== ctx.database!.toLowerCase()));
        let adviceEligible = supported && !unsafeUnbounded && !scopeViolation && !complexMutation && adviceTables.length === 1;
        if (unsafeUnbounded) riskFindings.push(`${ast.kind.toUpperCase()} without a WHERE clause is not returned as copy-ready SQL.`);
        else if (!supported) riskFindings.push("This statement class is outside copy-ready SQL Advice scope; only INSERT, bounded UPDATE/DELETE, and CREATE INDEX are eligible.");
        if (complexMutation) riskFindings.push("Complex or multi-table mutations are analyzed but not returned as copy-ready SQL.");
        if (isCreateIndex && !indexTarget) riskFindings.push("The CREATE INDEX target could not be resolved conservatively.");
        if (scopeViolation) riskFindings.push("The SQL references a database outside the bound session target and is not eligible for advice evidence.");

        const verifiedSchemas: TableSchema[] = [];
        for (const table of adviceTables) {
          const database = table.schema ?? ctx.database;
          if (!database) {
            assumptions.push(`Database for table ${table.name} was not resolved; schema evidence is unavailable.`);
            continue;
          }
          if (ctx.database && database.toLowerCase() !== ctx.database.toLowerCase()) continue;
          try {
            const schema = await deps.engine.describeTable(ctx, database, table.name);
            verifiedSchemas.push(schema);
            schemaFindings.push(schemaFinding(schema));
          } catch (error) {
            assumptions.push(`Schema evidence for ${database}.${table.name} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (adviceEligible && verifiedSchemas.length === 1) {
          const knownColumns = new Set(verifiedSchemas[0].columns.map((column) => column.name.toLowerCase()));
          const unknownColumns = ast.columns.map((column) => column.name).filter((name) => name !== "*" && !knownColumns.has(name.toLowerCase()));
          if (unknownColumns.length > 0) {
            adviceEligible = false;
            riskFindings.push(`Referenced columns are not present in current schema evidence: ${[...new Set(unknownColumns)].join(", ")}.`);
          }
          if (isCreateIndex) {
            const proposed = ast.columns.map((column) => column.name.toLowerCase());
            const duplicate = verifiedSchemas[0].indexes.find((index) => index.columns.map((column) => column.toLowerCase()).join("\u0000") === proposed.join("\u0000"));
            if (duplicate) {
              adviceEligible = false;
              riskFindings.push(`An index with the same ordered columns already exists: ${duplicate.name}.`);
            }
          }
        }

        if (adviceEligible && schemaFindings.length === 0) {
          adviceEligible = false;
          riskFindings.push("Copy-ready SQL was withheld because current schema evidence could not be verified.");
        }
        if (adviceEligible) advisedSql = normalized.normalizedSql;

        if (["insert", "update", "delete"].includes(ast.kind) && !unsafeUnbounded && !scopeViolation) {
          try {
            const plan = await deps.engine.explain(normalized.normalizedSql, ctx);
            fullScanLikely = plan.riskSummary.fullTableScanLikely;
            planFindings.push({ finding: "Database EXPLAIN completed without executing the mutation.", evidence: { plan: plan.plan, risk_summary: plan.riskSummary } });
            for (const recommendation of plan.recommendations) indexRecommendations.push({ finding: recommendation });
          } catch (error) {
            assumptions.push(`EXPLAIN evidence is unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        const countSql = scopeViolation ? undefined : buildImpactCountSql(normalized.normalizedSql, ast);
        if (countSql) {
          try {
            const count = await deps.engine.executeReadonly(countSql, ctx, { timeoutMs: ctx.limits.timeoutMs, maxRows: 1, maxColumns: 1, maxResultBytes: 1024 });
            matchedRowCount = readMatchedRowCount(count.rows) ?? null;
          } catch (error) {
            assumptions.push(`Matched-row count could not be verified: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else if (ast.kind === "update" || ast.kind === "delete") {
          assumptions.push("Matched-row count was not run because a safe single-table readonly COUNT could not be derived.");
        }
      }

      return formatSuccess({
        execution_status: "not_executed",
        original_sql: sql,
        advised_sql: advisedSql,
        statement_type: parsed.ok && !parsed.isMultiStatement ? parsed.ast.kind : statementType,
        schema_findings: schemaFindings,
        plan_findings: planFindings,
        index_recommendations: indexRecommendations,
        risk_findings: riskFindings,
        assumptions,
        unverified_business_rules: unverifiedBusinessRules,
        impact_analysis: { matched_row_count: matchedRowCount, sample_rows_read: false, full_scan_likely: fullScanLikely },
        human_review_required: true,
      }, {
        summary: "SQL Advice generated from readonly evidence. The mutation was not executed.",
        metadata: metadata(context.taskId, { sql_hash: normalized.sqlHash, statement_type: statementType }),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "analyze_mutation_sql",
        metadata: metadata(context.taskId, {
          statement_type: statementType,
        }),
      });
    }
  },
};

function requiredSqlSchema(description: string) {
  return z.string().trim().min(1).describe(description);
}

function optionalTokenSchema() {
  return z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Externally signed approval token for a high-risk readonly query.");
}
