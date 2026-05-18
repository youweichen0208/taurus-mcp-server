import type {
  ResponseMetadata,
  SessionContext,
  StatementType,
} from "taurusdb-core";
import { z } from "zod";
import {
  formatError,
  ErrorCode,
  type ToolResponse,
} from "../../utils/formatter.js";
import type { ToolDeps, ToolInvokeContext } from "../registry.js";
import { ToolInputError } from "../error-handling.js";

type RawContextInput = {
  datasource?: unknown;
  database?: unknown;
  schema?: unknown;
  timeout_ms?: unknown;
};

const STATEMENT_TYPES = new Set<StatementType>([
  "select",
  "show",
  "explain",
  "describe",
  "insert",
  "update",
  "delete",
  "alter",
  "drop",
  "create",
  "grant",
  "revoke",
  "unknown",
]);

export const contextInputShape = {
  datasource: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Datasource profile name. If omitted, the configured default datasource is used.",
    ),
  database: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Database name. Overrides the datasource default database for this tool call.",
    ),
  schema: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional schema name for engines that support schema scoping."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Statement timeout in milliseconds. Clamped by the server-side maximum.",
    ),
} as const;

export const diagnosticBaseInputShape = {
  ...contextInputShape,
  time_range: z
    .object({
      from: z.string().trim().min(1).optional(),
      to: z.string().trim().min(1).optional(),
      relative: z.string().trim().min(1).optional(),
    })
    .optional()
    .describe(
      "Optional diagnosis window. Use from/to or a relative window such as 15m or 1h.",
    ),
  evidence_level: z
    .enum(["basic", "standard", "full"])
    .optional()
    .describe("How much evidence the diagnostic should attempt to gather."),
  include_raw_evidence: z
    .boolean()
    .optional()
    .describe("Whether to include raw evidence references in the response."),
  max_candidates: z
    .number()
    .int()
    .positive()
    .max(10)
    .optional()
    .describe("Maximum number of root-cause candidates to return."),
} as const;

export function metadata(
  taskId: string,
  extra: Omit<ResponseMetadata, "task_id"> = {},
): ResponseMetadata {
  return {
    task_id: taskId,
    ...extra,
  };
}

export async function resolveContext(
  input: RawContextInput,
  deps: ToolDeps,
  context: ToolInvokeContext,
  readonly: boolean,
): Promise<SessionContext> {
  return deps.engine.resolveContext(
    {
      datasource: asOptionalString(input.datasource, "datasource"),
      database: asOptionalString(input.database, "database"),
      schema: asOptionalString(input.schema, "schema"),
      timeout_ms: asOptionalPositiveInteger(input.timeout_ms, "timeout_ms"),
      readonly,
    },
    context.taskId,
  );
}

export function requireDatabase(value: unknown, ctx: SessionContext): string {
  const explicit = asOptionalString(value, "database");
  const resolved = explicit ?? ctx.database;
  if (!resolved) {
    throw new ToolInputError(
      "Missing database. Provide input.database or configure a default database on the datasource profile.",
    );
  }
  return resolved;
}

export function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ToolInputError(`Invalid ${fieldName}: expected a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolInputError(`Invalid ${fieldName}: value cannot be empty.`);
  }
  return trimmed;
}

export function asOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asRequiredString(value, fieldName);
}

export function asOptionalPositiveInteger(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ToolInputError(
      `Invalid ${fieldName}: expected a positive integer.`,
    );
  }
  return value;
}

export function asOptionalBoolean(
  value: unknown,
  fieldName: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Invalid ${fieldName}: expected a boolean.`);
  }
  return value;
}

export function summarizeRows(rowCount: number, truncated: boolean): string {
  if (rowCount === 1) {
    return truncated ? "Returned 1 row (truncated)." : "Returned 1 row.";
  }
  return truncated
    ? `Returned ${rowCount} rows (truncated).`
    : `Returned ${rowCount} rows.`;
}

export function summarizeMutation(affectedRows: number): string {
  if (affectedRows === 1) {
    return "Mutation completed. 1 row affected.";
  }
  return `Mutation completed. ${affectedRows} rows affected.`;
}

export function statementTypeFromSql(sql: string): StatementType | undefined {
  const trimmed = sql.trim();
  if (!trimmed) {
    return undefined;
  }

  const firstToken = trimmed.match(/^([a-z]+)/i)?.[1]?.toLowerCase();
  if (!firstToken) {
    return undefined;
  }
  if (firstToken === "desc") {
    return "describe";
  }
  if (firstToken === "with") {
    return "select";
  }
  return STATEMENT_TYPES.has(firstToken as StatementType)
    ? (firstToken as StatementType)
    : undefined;
}

export function invalidInputResponse(
  message: string,
  taskId: string,
  summary = "Tool call failed due to invalid input.",
): ToolResponse {
  return formatError({
    code: ErrorCode.INVALID_INPUT,
    message,
    summary,
    metadata: metadata(taskId),
  });
}
