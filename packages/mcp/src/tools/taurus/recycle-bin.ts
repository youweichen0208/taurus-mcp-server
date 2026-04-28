import { z } from "zod";
import {
  buildRestoreRecycleBinTableSql,
  type RestoreRecycleBinTableInput,
} from "@huaweicloud/taurusdb-core";
import {
  ErrorCode,
  formatConfirmationRequired,
  formatError,
  formatSuccess,
  type ToolResponse,
} from "../../utils/formatter.js";
import { formatToolError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asOptionalString,
  asRequiredString,
  contextInputShape,
  metadata,
  resolveContext,
  summarizeMutation,
  summarizeRows,
  toPublicMutationResult,
  toPublicQueryResult,
} from "../common.js";

function parseRestoreMethod(value: unknown): RestoreRecycleBinTableInput["method"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "native_restore" || value === "insert_select") {
    return value;
  }
  throw new Error("Invalid method: expected native_restore or insert_select.");
}

export const listRecycleBinTool: ToolDefinition = {
  name: "list_recycle_bin",
  description:
    "List TaurusDB recycle bin tables. This is readonly and is intended for recovery triage after accidental DROP TABLE.",
  inputSchema: {
    datasource: contextInputShape.datasource,
    timeout_ms: contextInputShape.timeout_ms,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.listRecycleBin(ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          ...toPublicQueryResult(result),
        },
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            statement_type: "show",
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_recycle_bin",
        metadata: metadata(context.taskId, {
          statement_type: "show",
        }),
      });
    }
  },
};

export const restoreRecycleBinTableTool: ToolDefinition = {
  name: "restore_recycle_bin_table",
  description:
    "Restore a TaurusDB recycle bin table after explicit confirmation. Use insert_select for DRS/binlog-friendly recovery into a pre-created destination table.",
  inputSchema: {
    ...contextInputShape,
    recycle_table: z
      .string()
      .trim()
      .min(1)
      .describe("Recycle bin table name returned by list_recycle_bin."),
    method: z
      .enum(["native_restore", "insert_select"])
      .optional()
      .describe("Restore method. native_restore calls dbms_recyclebin.restore_table; insert_select copies rows into a pre-created destination table."),
    destination_database: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Destination database. Required for insert_select; optional with native_restore when renaming on restore."),
    destination_table: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Destination table. Required for insert_select; optional with native_restore when renaming on restore."),
    confirmation_token: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Confirmation token returned by the first guarded restore call."),
  },
  exposeWhen: (config) => config.enableMutations,
  async handler(input, deps, context): Promise<ToolResponse> {
    const restoreInput: RestoreRecycleBinTableInput = {
      recycleTable: asRequiredString(input.recycle_table, "recycle_table"),
      method: parseRestoreMethod(input.method),
      destinationDatabase: asOptionalString(input.destination_database, "destination_database"),
      destinationTable: asOptionalString(input.destination_table, "destination_table"),
    };

    try {
      const ctx = await resolveContext(input, deps, context, false);
      const sql = buildRestoreRecycleBinTableSql(restoreInput);
      const responseMetadata = metadata(context.taskId, {
        statement_type: restoreInput.method === "insert_select" ? "insert" : "unknown",
      });
      const confirmationToken = asOptionalString(input.confirmation_token, "confirmation_token");

      if (confirmationToken) {
        const validation = await deps.engine.validateConfirmation(confirmationToken, sql, ctx);
        if (!validation.valid) {
          return formatError({
            code: ErrorCode.CONFIRMATION_INVALID,
            message: validation.reason ?? "Confirmation token validation failed.",
            summary: "The provided confirmation token is invalid for this recycle bin restore.",
            metadata: responseMetadata,
            details: {
              reason_codes: validation.reasonCodes,
              risk_hints: validation.riskHints,
            },
          });
        }
      } else {
        const token = await deps.engine.issueConfirmation({
          sql,
          context: ctx,
          riskLevel: "high",
        });
        return formatConfirmationRequired({
          confirmationToken: token.token,
          metadata: responseMetadata,
          riskLevel: "high",
          summary: "Recycle bin restore requires explicit confirmation.",
          message:
            "Re-run restore_recycle_bin_table with the same input and confirmation_token to continue.",
        });
      }

      const result = await deps.engine.restoreRecycleBinTable(restoreInput, ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          recycle_table: restoreInput.recycleTable,
          method: restoreInput.method ?? "native_restore",
          destination_database: restoreInput.destinationDatabase,
          destination_table: restoreInput.destinationTable,
          ...toPublicMutationResult(result),
        },
        {
          summary: summarizeMutation(result.affectedRows),
          metadata: metadata(context.taskId, {
            statement_type: restoreInput.method === "insert_select" ? "insert" : "unknown",
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "restore_recycle_bin_table",
        metadata: metadata(context.taskId, {
          statement_type: restoreInput.method === "insert_select" ? "insert" : "unknown",
        }),
      });
    }
  },
};
