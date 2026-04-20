import type { ConnectionPool } from "./connection-pool.js";
import type { SessionContext } from "../context/session-context.js";
import type { ExplainRiskSummary } from "../safety/sql-validator.js";
import { type QueryTracker } from "./query-tracker.js";
import { type ResultRedactor, type SensitiveStrategy } from "../safety/redaction.js";
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
    explainForGuardrail(sql: string, ctx: SessionContext): Promise<ExplainRiskSummary>;
    explain(sql: string, ctx: SessionContext): Promise<ExplainResult>;
    executeReadonly(sql: string, ctx: SessionContext, opts?: ReadonlyOptions): Promise<QueryResult>;
    executeMutation(sql: string, ctx: SessionContext, opts?: MutationOptions): Promise<MutationResult>;
    getQueryStatus(queryId: string): Promise<QueryStatus>;
    cancelQuery(queryId: string): Promise<CancelResult>;
}
export type SqlExecutorOptions = {
    connectionPool: ConnectionPool;
    now?: () => number;
    queryIdGenerator?: () => string;
    historyLimit?: number;
    queryTracker?: QueryTracker;
    resultRedactor?: ResultRedactor;
};
export declare class SqlExecutorImpl implements SqlExecutor {
    private readonly connectionPool;
    private readonly now;
    private readonly queryIdGenerator;
    private readonly queryTracker;
    private readonly resultRedactor;
    private readonly activeSessions;
    constructor(options: SqlExecutorOptions);
    explainForGuardrail(sql: string, ctx: SessionContext): Promise<ExplainRiskSummary>;
    explain(sql: string, ctx: SessionContext): Promise<ExplainResult>;
    executeReadonly(sql: string, ctx: SessionContext, opts?: ReadonlyOptions): Promise<QueryResult>;
    executeMutation(sql: string, ctx: SessionContext, opts?: MutationOptions): Promise<MutationResult>;
    getQueryStatus(queryId: string): Promise<QueryStatus>;
    cancelQuery(queryId: string): Promise<CancelResult>;
    private beginQuery;
    private completeQuery;
    private endQuerySession;
}
export declare function createSqlExecutor(options: SqlExecutorOptions): SqlExecutor;
