import { z } from "zod";
import { ErrorCode, formatBlocked, formatConfirmationRequired, formatError, formatSuccess, type ToolResponse } from "../utils/formatter.js";
import { formatToolError } from "./error-handling.js";
import type { ToolDefinition } from "./registry.js";
import {
  asOptionalString,
  asRequiredString,
  contextInputShape,
  metadata,
  resolveContext,
  statementTypeFromSql,
  summarizeMutation,
  summarizeRows,
  toPublicCancelResult,
  toPublicExplainResult,
  toPublicGuardrailDecision,
  toPublicMutationResult,
  toPublicQueryResult,
  toPublicQueryStatus,
} from "./common.js";
import type { GuardrailDecision, SessionContext } from "@huaweicloud/taurusdb-core";

function blockedReason(decision: GuardrailDecision): string {
  return decision.riskHints[0] ?? "The SQL statement is blocked by safety policy.";
}

async function inspectSql(
  toolName: "execute_readonly_sql" | "execute_sql" | "explain_sql",
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
  sql: string,
  decision: GuardrailDecision,
  ctx: SessionContext,
  deps: Parameters<ToolDefinition["handler"]>[1],
  taskId: string,
  confirmationToken: string | undefined,
): Promise<ToolResponse | undefined> {
  if (!decision.requiresConfirmation) {
    return undefined;
  }

  const responseMetadata = metadata(taskId, {
    sql_hash: decision.sqlHash,
    statement_type: statementTypeFromSql(sql),
  });

  if (confirmationToken) {
    const validation = await deps.engine.validateConfirmation(confirmationToken, sql, ctx);
    if (validation.valid) {
      return undefined;
    }
    return formatError({
      code: ErrorCode.CONFIRMATION_INVALID,
      message: validation.reason ?? "Confirmation token validation failed.",
      summary: "The provided confirmation token is invalid for this SQL statement.",
      metadata: responseMetadata,
      details: {
        reason_codes: validation.reasonCodes,
        risk_hints: validation.riskHints,
      },
    });
  }

  const outcome = await deps.engine.handleConfirmation(decision, ctx);
  if (outcome.status === "token_issued") {
    return formatConfirmationRequired({
      confirmationToken: outcome.token,
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
    confirmation_token: optionalTokenSchema(),
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
        sql,
        decision,
        ctx,
        deps,
        context.taskId,
        asOptionalString(input.confirmation_token, "confirmation_token"),
      );
      if (confirmationResponse) {
        return confirmationResponse;
      }

      const result = await deps.engine.executeReadonly(sql, ctx, {
        timeoutMs: decision.runtimeLimits.timeoutMs,
        maxRows: decision.runtimeLimits.maxRows,
        maxColumns: decision.runtimeLimits.maxColumns,
        maxFieldChars: decision.runtimeLimits.maxFieldChars,
      });

      return formatSuccess(
        toPublicQueryResult(result),
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            query_id: result.queryId,
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

      const result = await deps.engine.explain(sql, ctx);
      return formatSuccess(
        toPublicExplainResult(result, decision),
        {
          summary:
            decision.requiresConfirmation
              ? "Explain generated. Executing this SQL would require explicit confirmation."
              : "Explain generated.",
          metadata: metadata(context.taskId, {
            query_id: result.queryId,
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

export const getQueryStatusTool: ToolDefinition = {
  name: "get_query_status",
  description: "Get the execution status of a previously issued query_id.",
  inputSchema: {
    query_id: z
      .string()
      .trim()
      .min(1)
      .describe("Query identifier returned by execute_readonly_sql, explain_sql, or execute_sql."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const queryId = asRequiredString(input.query_id, "query_id");
      const result = await deps.engine.getQueryStatus(queryId);
      return formatSuccess(
        toPublicQueryStatus(result),
        {
          summary: `Query ${queryId} is ${result.status}.`,
          metadata: metadata(context.taskId, {
            query_id: result.queryId,
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "get_query_status",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const cancelQueryTool: ToolDefinition = {
  name: "cancel_query",
  description: "Cancel a running query_id if it is still active.",
  inputSchema: {
    query_id: z
      .string()
      .trim()
      .min(1)
      .describe("Query identifier returned by a previous tool call."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const queryId = asRequiredString(input.query_id, "query_id");
      const result = await deps.engine.cancelQuery(queryId);
      return formatSuccess(
        toPublicCancelResult(result),
        {
          summary: `Query ${queryId} cancellation result: ${result.status}.`,
          metadata: metadata(context.taskId, {
            query_id: result.queryId,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "cancel_query",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const executeSqlTool: ToolDefinition = {
  name: "execute_sql",
  description: "Execute mutation SQL such as INSERT, UPDATE, or DELETE when mutations are explicitly enabled.",
  inputSchema: {
    ...contextInputShape,
    sql: requiredSqlSchema("Mutation SQL to execute."),
    confirmation_token: optionalTokenSchema(),
  },
  exposeWhen: (config) => config.enableMutations,
  async handler(input, deps, context): Promise<ToolResponse> {
    const sql = asRequiredString(input.sql, "sql");
    const statementType = statementTypeFromSql(sql);

    try {
      const ctx = await resolveContext(input, deps, context, false);
      const decision = await inspectSql("execute_sql", sql, ctx, deps);
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
        sql,
        decision,
        ctx,
        deps,
        context.taskId,
        asOptionalString(input.confirmation_token, "confirmation_token"),
      );
      if (confirmationResponse) {
        return confirmationResponse;
      }

      const result = await deps.engine.executeMutation(sql, ctx, {
        timeoutMs: decision.runtimeLimits.timeoutMs,
      });
      return formatSuccess(
        toPublicMutationResult(result),
        {
          summary: summarizeMutation(result.affectedRows),
          metadata: metadata(context.taskId, {
            query_id: result.queryId,
            sql_hash: decision.sqlHash,
            statement_type: statementType,
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "execute_sql",
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
    .describe("Confirmation token returned by a previous guarded call when required.");
}
