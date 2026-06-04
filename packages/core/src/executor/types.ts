import type { SessionContext } from "../context/session-context.js";
import type { SensitiveStrategy } from "../safety/redaction.js";
import type { ExplainRiskSummary } from "../safety/sql-validator.js";

export interface ColumnMeta {
  name: string;
  type?: string;
}

export interface ReadonlyOptions {
  maxRows?: number;
  maxColumns?: number;
  maxFieldChars?: number;
  timeoutMs?: number;
  sensitiveColumns?: Iterable<string>;
  sensitiveStrategy?: SensitiveStrategy;
}

export interface MutationOptions {
  timeoutMs?: number;
  allowReadonlyFallbackForMutations?: boolean;
}

export interface QueryResult {
  queryId: string;
  columns: ColumnMeta[];
  rows: unknown[][];
  rowCount: number;
  originalRowCount: number;
  truncated: boolean;
  rowTruncated: boolean;
  columnTruncated: boolean;
  fieldTruncated: boolean;
  redactedColumns: string[];
  droppedColumns: string[];
  truncatedColumns: string[];
  durationMs: number;
}

export interface MutationResult {
  queryId: string;
  affectedRows: number;
  durationMs: number;
}

export interface ExplainResult {
  queryId: string;
  plan: Record<string, unknown>[];
  riskSummary: ExplainRiskSummary;
  recommendations: string[];
  durationMs: number;
}

export interface QueryStatus {
  queryId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "not_found";
  taskId?: string;
  datasource?: string;
  mode?: "ro" | "rw";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface CancelResult {
  queryId: string;
  status: "cancelled" | "not_found" | "completed" | "failed";
  message?: string;
}

export interface SqlExecutor {
  explain(sql: string, ctx: SessionContext): Promise<ExplainResult>;
  executeReadonly(
    sql: string,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult>;
  executeMutation(
    sql: string,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult>;
  getQueryStatus(queryId: string): Promise<QueryStatus>;
  cancelQuery(queryId: string): Promise<CancelResult>;
}
