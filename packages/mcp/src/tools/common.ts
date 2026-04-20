import type {
  CancelResult,
  DataSourceInfo,
  DatabaseInfo,
  ExplainResult,
  GuardrailDecision,
  MutationResult,
  QueryResult,
  QueryStatus,
  ResponseMetadata,
  SessionContext,
  StatementType,
  TableInfo,
  TableSchema,
  SampleResult,
} from "@huaweicloud/taurusdb-core";
import { z } from "zod";
import { formatError, ErrorCode, type ToolResponse } from "../utils/formatter.js";
import type { ToolDeps, ToolInvokeContext } from "./registry.js";
import { ToolInputError } from "./error-handling.js";

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
    .describe("Datasource profile name. If omitted, the configured default datasource is used."),
  database: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Database name. Overrides the datasource default database for this tool call."),
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
    .describe("Statement timeout in milliseconds. Clamped by the server-side maximum."),
} as const;

export function metadata(taskId: string, extra: Omit<ResponseMetadata, "task_id"> = {}): ResponseMetadata {
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

export function asOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asRequiredString(value, fieldName);
}

export function asOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ToolInputError(`Invalid ${fieldName}: expected a positive integer.`);
  }
  return value;
}

export function summarizeRows(rowCount: number, truncated: boolean): string {
  if (rowCount === 1) {
    return truncated ? "Returned 1 row (truncated)." : "Returned 1 row.";
  }
  return truncated ? `Returned ${rowCount} rows (truncated).` : `Returned ${rowCount} rows.`;
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
    code: ErrorCode.SQL_SYNTAX_ERROR,
    message,
    summary,
    metadata: metadata(taskId),
  });
}

export function toPublicDataSourceInfo(info: DataSourceInfo) {
  return {
    name: info.name,
    engine: info.engine,
    host: info.host,
    port: info.port,
    database: info.database,
    has_mutation_user: info.hasMutationUser,
    pool_size: info.poolSize,
    is_default: info.isDefault,
  };
}

export function toPublicDatabaseInfo(info: DatabaseInfo) {
  return {
    name: info.name,
    owner: info.owner,
    comment: info.comment,
  };
}

export function toPublicTableInfo(info: TableInfo) {
  return {
    database: info.database,
    name: info.name,
    type: info.type,
    comment: info.comment,
    row_count_estimate: info.rowCountEstimate,
  };
}

export function toPublicTableSchema(schema: TableSchema) {
  return {
    database: schema.database,
    table: schema.table,
    columns: schema.columns.map((column) => ({
      name: column.name,
      data_type: column.dataType,
      nullable: column.nullable,
      default_value: column.defaultValue,
      max_length: column.maxLength,
      is_primary_key: column.isPrimaryKey,
      is_indexed: column.isIndexed,
      comment: column.comment,
    })),
    indexes: schema.indexes.map((index) => ({
      name: index.name,
      columns: index.columns,
      unique: index.unique,
      type: index.type,
    })),
    primary_key: schema.primaryKey,
    engine_hints: schema.engineHints
      ? {
          likely_time_columns: schema.engineHints.likelyTimeColumns,
          likely_filter_columns: schema.engineHints.likelyFilterColumns,
          sensitive_columns: schema.engineHints.sensitiveColumns,
        }
      : undefined,
    comment: schema.comment,
    row_count_estimate: schema.rowCountEstimate,
  };
}

export function toPublicSampleResult(sample: SampleResult) {
  return {
    database: sample.database,
    table: sample.table,
    columns: sample.columns,
    rows: sample.rows,
    redacted_columns: sample.redactedColumns,
    truncated_columns: sample.truncatedColumns,
    sample_size: sample.sampleSize,
    truncated: sample.truncated,
    total_row_count: sample.totalRowCount,
  };
}

export function toPublicQueryResult(result: QueryResult) {
  return {
    columns: result.columns,
    rows: result.rows,
    row_count: result.rowCount,
    original_row_count: result.originalRowCount,
    truncated: result.truncated,
    row_truncated: result.rowTruncated,
    column_truncated: result.columnTruncated,
    field_truncated: result.fieldTruncated,
    redacted_columns: result.redactedColumns,
    dropped_columns: result.droppedColumns,
    truncated_columns: result.truncatedColumns,
  };
}

export function toPublicMutationResult(result: MutationResult) {
  return {
    affected_rows: result.affectedRows,
  };
}

export function toPublicQueryStatus(status: QueryStatus) {
  return {
    query_id: status.queryId,
    status: status.status,
    task_id: status.taskId,
    datasource: status.datasource,
    mode: status.mode,
    started_at: status.startedAt,
    ended_at: status.endedAt,
    duration_ms: status.durationMs,
    error: status.error,
  };
}

export function toPublicCancelResult(result: CancelResult) {
  return {
    query_id: result.queryId,
    status: result.status,
    message: result.message,
  };
}

export function toPublicGuardrailDecision(decision: GuardrailDecision) {
  return {
    action: decision.action,
    risk_level: decision.riskLevel,
    reason_codes: decision.reasonCodes,
    risk_hints: decision.riskHints,
    requires_explain: decision.requiresExplain,
    requires_confirmation: decision.requiresConfirmation,
    sql_hash: decision.sqlHash,
    runtime_limits: {
      readonly: decision.runtimeLimits.readonly,
      timeout_ms: decision.runtimeLimits.timeoutMs,
      max_rows: decision.runtimeLimits.maxRows,
      max_columns: decision.runtimeLimits.maxColumns,
      max_field_chars: decision.runtimeLimits.maxFieldChars,
    },
  };
}

export function toPublicExplainResult(result: ExplainResult, decision: GuardrailDecision) {
  return {
    plan: result.plan,
    risk_summary: {
      full_table_scan_likely: result.riskSummary.fullTableScanLikely,
      index_hit_likely: result.riskSummary.indexHitLikely,
      estimated_rows: result.riskSummary.estimatedRows,
      uses_temp_structure: result.riskSummary.usesTempStructure,
      uses_filesort: result.riskSummary.usesFilesort,
      risk_hints: result.riskSummary.riskHints,
    },
    recommendations: result.recommendations,
    guardrail: toPublicGuardrailDecision(decision),
  };
}
