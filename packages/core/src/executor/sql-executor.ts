import { generateQueryId } from "../utils/id.js";
import type {
  ConnectionPool,
  RawResult,
  Session,
} from "./connection-pool.js";
import {
  buildExplainRecommendations,
  normalizeExplainRows,
  summarizeExplainRows,
} from "./explain.js";
import type { SessionContext } from "../context/session-context.js";
import type { ExplainRiskSummary } from "../safety/sql-validator.js";
import {
  createQueryTracker,
  type QueryTracker,
} from "./query-tracker.js";
import {
  createResultRedactor,
  type ResultRedactor,
  type SensitiveStrategy,
} from "../safety/redaction.js";

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
  explainForGuardrail(
    sql: string,
    ctx: SessionContext,
  ): Promise<ExplainRiskSummary>;
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

type ActiveSession = {
  queryId: string;
  session: Session;
  startedAt: number;
  cancelRequested: boolean;
};

export type SqlExecutorOptions = {
  connectionPool: ConnectionPool;
  now?: () => number;
  queryIdGenerator?: () => string;
  historyLimit?: number;
  queryTracker?: QueryTracker;
  resultRedactor?: ResultRedactor;
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inferColumns(raw: RawResult, rows: unknown[]): ColumnMeta[] {
  if (Array.isArray(raw.fields) && raw.fields.length > 0) {
    return raw.fields.map((field) => ({
      name: field.name,
      type: field.type,
    }));
  }

  const first = rows[0];
  if (isObject(first)) {
    return Object.keys(first).map((name) => ({ name }));
  }
  if (Array.isArray(first)) {
    return first.map((_, index) => ({ name: `col_${index + 1}` }));
  }
  return [];
}

function normalizeRows(rows: unknown[], columns: ColumnMeta[]): unknown[][] {
  if (rows.length === 0) {
    return [];
  }
  const first = rows[0];
  if (Array.isArray(first)) {
    return rows.map((row) => (Array.isArray(row) ? row : [row]));
  }
  if (isObject(first)) {
    return rows.map((row) => {
      if (!isObject(row)) {
        return [row];
      }
      return columns.map((column) => row[column.name]);
    });
  }
  return rows.map((row) => [row]);
}


export class SqlExecutorImpl implements SqlExecutor {
  private readonly connectionPool: ConnectionPool;
  private readonly now: () => number;
  private readonly queryIdGenerator: () => string;
  private readonly queryTracker: QueryTracker;
  private readonly resultRedactor: ResultRedactor;
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(options: SqlExecutorOptions) {
    this.connectionPool = options.connectionPool;
    this.now = options.now ?? Date.now;
    this.queryIdGenerator = options.queryIdGenerator ?? (() => generateQueryId());
    this.queryTracker =
      options.queryTracker ??
      createQueryTracker({
        now: this.now,
        historyLimit: options.historyLimit,
      });
    this.resultRedactor = options.resultRedactor ?? createResultRedactor();
  }

  async explainForGuardrail(
    sql: string,
    ctx: SessionContext,
  ): Promise<ExplainRiskSummary> {
    const session = await this.connectionPool.acquire(ctx.datasource, "ro");
    try {
      const result = await session.execute(`EXPLAIN ${sql}`, {
        timeoutMs: ctx.limits.timeoutMs,
      });
      const rows = normalizeExplainRows(result);
      return summarizeExplainRows(rows);
    } finally {
      await this.connectionPool.release(session);
    }
  }

  async explain(sql: string, ctx: SessionContext): Promise<ExplainResult> {
    const queryId = this.queryIdGenerator();
    const startedAt = this.now();
    const session = await this.connectionPool.acquire(ctx.datasource, "ro");
    const active = this.beginQuery(queryId, session, ctx, "ro", startedAt);

    try {
      const result = await session.execute(`EXPLAIN ${sql}`, {
        timeoutMs: ctx.limits.timeoutMs,
      });
      const plan = normalizeExplainRows(result);
      const riskSummary = summarizeExplainRows(plan);
      const recommendations = buildExplainRecommendations(riskSummary);
      const durationMs = this.now() - startedAt;
      this.completeQuery(active.queryId, "completed", durationMs);

      return {
        queryId,
        plan,
        riskSummary,
        recommendations,
        durationMs,
      };
    } catch (error) {
      const durationMs = this.now() - startedAt;
      this.completeQuery(
        active.queryId,
        active.cancelRequested ? "cancelled" : "failed",
        durationMs,
        error,
      );
      throw error;
    } finally {
      await this.endQuerySession(active.queryId);
    }
  }

  async executeReadonly(
    sql: string,
    ctx: SessionContext,
    opts: ReadonlyOptions = {},
  ): Promise<QueryResult> {
    const queryId = this.queryIdGenerator();
    const startedAt = this.now();
    const maxRows = opts.maxRows ?? ctx.limits.maxRows;
    const maxColumns = opts.maxColumns ?? ctx.limits.maxColumns;
    const maxFieldChars = opts.maxFieldChars ?? ctx.limits.maxFieldChars ?? 2048;
    const timeoutMs = opts.timeoutMs ?? ctx.limits.timeoutMs;

    const session = await this.connectionPool.acquire(ctx.datasource, "ro");
    const active = this.beginQuery(queryId, session, ctx, "ro", startedAt);

    try {
      const result = await session.execute(sql, { timeoutMs });
      const sourceRows = Array.isArray(result.rows) ? result.rows : [];
      const columns = inferColumns(result, sourceRows);
      const normalizedRows = normalizeRows(sourceRows, columns);
      const rowCount = asFiniteNumber(result.rowCount) ?? normalizedRows.length;
      const redacted = this.resultRedactor.redact(
        {
          columns,
          rows: normalizedRows,
          rowCount,
        },
        {
          maxRows,
          maxColumns,
          maxFieldChars,
          sensitiveColumns: opts.sensitiveColumns,
          sensitiveStrategy: opts.sensitiveStrategy,
        },
      );
      const durationMs = this.now() - startedAt;
      this.completeQuery(active.queryId, "completed", durationMs);

      return {
        queryId,
        columns: redacted.columns,
        rows: redacted.rows,
        rowCount: redacted.rowCount,
        originalRowCount: redacted.originalRowCount,
        truncated: redacted.truncated,
        rowTruncated: redacted.rowTruncated,
        columnTruncated: redacted.columnTruncated,
        fieldTruncated: redacted.fieldTruncated,
        redactedColumns: redacted.redactedColumns,
        droppedColumns: redacted.droppedColumns,
        truncatedColumns: redacted.truncatedColumns,
        durationMs,
      };
    } catch (error) {
      const durationMs = this.now() - startedAt;
      this.completeQuery(
        active.queryId,
        active.cancelRequested ? "cancelled" : "failed",
        durationMs,
        error,
      );
      throw error;
    } finally {
      await this.endQuerySession(active.queryId);
    }
  }

  async executeMutation(
    sql: string,
    ctx: SessionContext,
    opts: MutationOptions = {},
  ): Promise<MutationResult> {
    if (ctx.limits.readonly) {
      throw new Error("Readonly session context cannot execute mutation SQL.");
    }

    const queryId = this.queryIdGenerator();
    const startedAt = this.now();
    const timeoutMs = opts.timeoutMs ?? ctx.limits.timeoutMs;

    const session = await this.connectionPool.acquire(ctx.datasource, "rw");
    const active = this.beginQuery(queryId, session, ctx, "rw", startedAt);

    try {
      await session.execute("BEGIN", { timeoutMs });
      const result = await session.execute(sql, { timeoutMs });
      await session.execute("COMMIT", { timeoutMs });

      const affectedRows =
        asFiniteNumber(result.affectedRows) ??
        asFiniteNumber(result.rowCount) ??
        0;
      const durationMs = this.now() - startedAt;
      this.completeQuery(active.queryId, "completed", durationMs);

      return {
        queryId,
        affectedRows,
        durationMs,
      };
    } catch (error) {
      try {
        await session.execute("ROLLBACK", { timeoutMs });
      } catch {
        // Ignore rollback failure and keep original error.
      }
      const durationMs = this.now() - startedAt;
      this.completeQuery(
        active.queryId,
        active.cancelRequested ? "cancelled" : "failed",
        durationMs,
        error,
      );
      throw error;
    } finally {
      await this.endQuerySession(active.queryId);
    }
  }

  async getQueryStatus(queryId: string): Promise<QueryStatus> {
    const info = this.queryTracker.get(queryId);
    if (!info) {
      return {
        queryId,
        status: "not_found",
      };
    }

    return {
      queryId,
      taskId: info.taskId,
      datasource: info.datasource,
      mode: info.mode,
      status: info.status,
      startedAt: info.startedAt,
      endedAt: info.endedAt,
      durationMs: info.durationMs,
      error: info.error,
    };
  }

  async cancelQuery(queryId: string): Promise<CancelResult> {
    const active = this.activeSessions.get(queryId);
    if (!active) {
      const info = this.queryTracker.get(queryId);
      if (!info) {
        return { queryId, status: "not_found" };
      }
      if (info.status === "completed") {
        return { queryId, status: "completed" };
      }
      return {
        queryId,
        status: info.status === "failed" ? "failed" : "cancelled",
        message: info.error,
      };
    }

    active.cancelRequested = true;
    try {
      await active.session.cancel();
      const now = this.now();
      this.completeQuery(queryId, "cancelled", now - active.startedAt);
      return {
        queryId,
        status: "cancelled",
      };
    } catch (error) {
      const now = this.now();
      this.completeQuery(queryId, "failed", now - active.startedAt, error);
      return {
        queryId,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private beginQuery(
    queryId: string,
    session: Session,
    ctx: SessionContext,
    mode: "ro" | "rw",
    startedAt: number,
  ): ActiveSession {
    const active: ActiveSession = {
      queryId,
      session,
      startedAt,
      cancelRequested: false,
    };
    this.activeSessions.set(queryId, active);
    this.queryTracker.register(queryId, {
      queryId,
      taskId: ctx.task_id,
      datasource: ctx.datasource,
      mode,
      status: "running",
      startedAt,
    });
    return active;
  }

  private completeQuery(
    queryId: string,
    status: "completed" | "failed" | "cancelled",
    durationMs: number,
    error?: unknown,
  ): void {
    const info = this.queryTracker.get(queryId);
    if (!info) {
      return;
    }

    const endedAt = info.startedAt + durationMs;
    const errorMessage =
      error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;

    this.queryTracker.markCompleted(queryId, {
      status,
      endedAt,
      durationMs,
      error: errorMessage,
    });
  }

  private async endQuerySession(queryId: string): Promise<void> {
    const active = this.activeSessions.get(queryId);
    if (!active) {
      return;
    }
    this.activeSessions.delete(queryId);
    await this.connectionPool.release(active.session);
  }
}

export function createSqlExecutor(options: SqlExecutorOptions): SqlExecutor {
  return new SqlExecutorImpl(options);
}
