import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../utils/formatter.js";
import { formatToolError, ToolInputError } from "./error-handling.js";
import type { ToolDefinition } from "./registry.js";
import {
  asOptionalBoolean,
  asOptionalPositiveInteger,
  asOptionalString,
  contextInputShape,
  metadata,
  resolveContext,
  toPublicQueryResult,
} from "./common.js";

function summarizeProcesslistRows(
  rowCount: number,
  truncated: boolean,
): string {
  if (rowCount === 1) {
    return truncated
      ? "Returned 1 processlist row (truncated)."
      : "Returned 1 processlist row.";
  }
  return truncated
    ? `Returned ${rowCount} processlist rows (truncated).`
    : `Returned ${rowCount} processlist rows.`;
}

export const showProcesslistTool: ToolDefinition = {
  name: "show_processlist",
  description:
    "Show current MySQL processlist rows with safe defaults for connection and lock troubleshooting.",
  inputSchema: {
    ...contextInputShape,
    user: optionalStringSchema("Optional user to focus on."),
    host: optionalStringSchema(
      "Optional host or client IP prefix to focus on.",
    ),
    session_database: optionalStringSchema(
      "Optional processlist DB value to focus on.",
    ),
    command: optionalStringSchema(
      "Optional command to focus on, such as Query or Sleep.",
    ),
    min_time_seconds: nonNegativeIntegerSchema(
      "Only include rows whose TIME value is at least this many seconds.",
    ).optional(),
    max_rows: positiveIntegerSchema(
      "Maximum number of processlist rows to return.",
    )
      .max(100)
      .optional()
      .default(20),
    include_idle: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to include Sleep sessions."),
    include_system: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to include system user sessions."),
    include_info: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to include truncated SQL text from the INFO column."),
    info_max_chars: positiveIntegerSchema(
      "Maximum length of INFO text to return when include_info is true.",
    )
      .max(2048)
      .optional()
      .default(256),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const user = asOptionalString(input.user, "user");
      const host = asOptionalString(input.host, "host");
      const sessionDatabase = asOptionalString(
        input.session_database,
        "session_database",
      );
      const command = asOptionalString(input.command, "command");
      const minTimeSeconds =
        asOptionalNonNegativeInteger(
          input.min_time_seconds,
          "min_time_seconds",
        ) ?? 0;
      const maxRows =
        asOptionalPositiveInteger(input.max_rows, "max_rows") ?? 20;
      const includeIdle =
        asOptionalBoolean(input.include_idle, "include_idle") ?? false;
      const includeSystem =
        asOptionalBoolean(input.include_system, "include_system") ?? false;
      const includeInfo =
        asOptionalBoolean(input.include_info, "include_info") ?? false;
      const infoMaxChars =
        asOptionalPositiveInteger(input.info_max_chars, "info_max_chars") ??
        256;
      const result = await deps.engine.showProcesslist(
        {
          user,
          host,
          sessionDatabase,
          command,
          minTimeSeconds,
          maxRows,
          includeIdle,
          includeSystem,
          includeInfo,
          infoMaxChars,
        },
        ctx,
      );

      return formatSuccess(
        {
          datasource: ctx.datasource,
          filters: {
            user,
            host,
            session_database: sessionDatabase,
            command,
            min_time_seconds: minTimeSeconds || undefined,
            include_idle: includeIdle,
            include_system: includeSystem,
            include_info: includeInfo,
            max_rows: maxRows,
          },
          ...toPublicQueryResult(result),
        },
        {
          summary: summarizeProcesslistRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "show_processlist",
        metadata: metadata(context.taskId),
      });
    }
  },
};

function optionalStringSchema(description: string) {
  return z.string().trim().min(1).optional().describe(description);
}

function positiveIntegerSchema(description: string) {
  return z.number().int().positive().describe(description);
}

function nonNegativeIntegerSchema(description: string) {
  return z.number().int().nonnegative().describe(description);
}

function asOptionalNonNegativeInteger(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ToolInputError(
      `Invalid ${fieldName}: expected a non-negative integer.`,
    );
  }
  return value;
}
