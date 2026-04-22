import { z } from "zod";
import { formatBlocked, formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asRequiredString,
  contextInputShape,
  metadata,
  resolveContext,
  statementTypeFromSql,
  toPublicEnhancedExplainResult,
} from "../common.js";

const READONLY_EXPLAIN_TYPES = new Set(["select", "show", "describe", "explain"]);

function isReadonlyExplainSql(sql: string): boolean {
  const statementType = statementTypeFromSql(sql);
  return statementType !== undefined && READONLY_EXPLAIN_TYPES.has(statementType);
}

export const explainSqlEnhancedTool: ToolDefinition = {
  name: "explain_sql_enhanced",
  description:
    "Run TaurusDB-aware EXPLAIN on a readonly SQL statement and return NDP/PQ/OFFSET hints with optimization suggestions.",
  inputSchema: {
    ...contextInputShape,
    sql: z.string().trim().min(1).describe("Readonly SQL statement to analyze."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    const sql = asRequiredString(input.sql, "sql");
    const statementType = statementTypeFromSql(sql);

    try {
      if (!isReadonlyExplainSql(sql)) {
        return formatBlocked({
          reason: "Tool explain_sql_enhanced only supports readonly SQL statements.",
          metadata: metadata(context.taskId, {
            statement_type: statementType,
          }),
          summary: "Enhanced EXPLAIN is limited to readonly SQL.",
        });
      }

      const ctx = await resolveContext(input, deps, context, true);
      const decision = await deps.engine.inspectSql({
        toolName: "explain_sql_enhanced",
        sql,
        context: ctx,
      });

      if (decision.action === "block") {
        return formatBlocked({
          reason: decision.riskHints[0] ?? "The SQL statement is blocked by safety policy.",
          metadata: metadata(context.taskId, {
            sql_hash: decision.sqlHash,
            statement_type: statementType,
          }),
          details: {
            risk_level: decision.riskLevel,
            reason_codes: decision.reasonCodes,
            risk_hints: decision.riskHints,
          },
        });
      }

      const result = await deps.engine.explainEnhanced(sql, ctx);
      return formatSuccess(
        toPublicEnhancedExplainResult(result, decision),
        {
          summary: "Enhanced EXPLAIN generated.",
          metadata: metadata(context.taskId, {
            sql_hash: decision.sqlHash,
            statement_type: statementType,
            duration_ms: result.standardPlan.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "explain_sql_enhanced",
        metadata: metadata(context.taskId, {
          statement_type: statementType,
        }),
      });
    }
  },
};
