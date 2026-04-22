import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asOptionalPositiveInteger,
  asOptionalString,
  asRequiredString,
  contextInputShape,
  metadata,
  requireDatabase,
  resolveContext,
  summarizeRows,
  toPublicQueryResult,
} from "../common.js";

const asOfSchema = z
  .object({
    timestamp: z.string().trim().min(1).optional(),
    relative: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.timestamp) !== Boolean(value.relative), {
    message: "Provide exactly one of as_of.timestamp or as_of.relative.",
  })
  .describe("Flashback point in time. Use either an absolute timestamp or a relative duration like 5m.");

function parseColumns(input: unknown): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error("Invalid columns: expected an array of strings.");
  }
  return input.map((value, index) => asRequiredString(value, `columns[${index}]`));
}

function parseAsOf(
  input: unknown,
): { timestamp: string; relative?: never } | { timestamp?: never; relative: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid as_of: expected an object.");
  }

  const record = input as Record<string, unknown>;
  const timestamp = asOptionalString(record.timestamp, "as_of.timestamp");
  const relative = asOptionalString(record.relative, "as_of.relative");

  if (Boolean(timestamp) === Boolean(relative)) {
    throw new Error("Provide exactly one of as_of.timestamp or as_of.relative.");
  }

  if (timestamp) {
    return { timestamp };
  }

  return { relative: relative! };
}

export const flashbackQueryTool: ToolDefinition = {
  name: "flashback_query",
  description:
    "Run a TaurusDB flashback SELECT against a historical timestamp using the normal readonly execution path.",
  inputSchema: {
    ...contextInputShape,
    table: z.string().trim().min(1).describe("Table name to query historically."),
    as_of: asOfSchema,
    where: z.string().trim().min(1).optional().describe("Optional SQL WHERE clause body."),
    columns: z.array(z.string().trim().min(1)).optional().describe("Optional column projection."),
    limit: z.number().int().positive().optional().describe("Maximum rows to return."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const database = requireDatabase(input.database, ctx);
      const table = asRequiredString(input.table, "table");
      const result = await deps.engine.flashbackQuery(
        {
          database,
          table,
          asOf: parseAsOf(input.as_of),
          where: asOptionalString(input.where, "where"),
          columns: parseColumns(input.columns),
          limit: asOptionalPositiveInteger(input.limit, "limit"),
        },
        ctx,
      );

      return formatSuccess(
        {
          datasource: ctx.datasource,
          database,
          table,
          ...toPublicQueryResult(result),
        },
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            statement_type: "select",
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "flashback_query",
        metadata: metadata(context.taskId, {
          statement_type: "select",
        }),
      });
    }
  },
};
