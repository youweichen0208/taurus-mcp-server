import { generateQueryId } from "../utils/id.js";
import type { ConnectionPool, Session } from "./connection-pool.js";
import {
  buildExplainRecommendations,
  normalizeExplainRows,
  summarizeExplainRows,
} from "./explain.js";
import type { SessionContext } from "../context/session-context.js";
import {
  createQueryTracker,
  type QueryTracker,
} from "./query-tracker.js";
import {
  createResultRedactor,
  type ResultRedactor,
} from "../safety/redaction.js";
import { asFiniteNumber, inferColumns, normalizeRows } from "./result-normalizer.js";
import { QueryConcurrencyLimiter } from "./concurrency-limiter.js";
import { buildServerBoundedReadonlySql } from "./bounded-sql.js";
import type {
  CancelResult,
  ExplainResult,
  MutationOptions,
  MutationResult,
  QueryResult,
  QueryStatus,
  ReadonlyOptions,
  SqlExecutor,
} from "./types.js";
export type {
  CancelResult,
  ColumnMeta,
  ExplainResult,
  MutationOptions,
  MutationResult,
  QueryResult,
  QueryStatus,
  ReadonlyOptions,
  SqlExecutor,
} from "./types.js";

type ActiveSession = {
  queryId: string;
  session: Session;
  startedAt: number;
  cancelRequested: boolean;
};

function isTimeoutError(error: unknown): boolean {
  return /timeout|timed out/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function cancelTimedOutSession(
  session: Session,
  error: unknown,
): Promise<void> {
  if (!isTimeoutError(error)) {
    return;
  }
  try {
    await session.cancel();
  } catch {
    // Keep the original timeout error.
  }
}

export type SqlExecutorOptions = {
  connectionPool: ConnectionPool;
  now?: () => number;
  queryIdGenerator?: () => string;
  historyLimit?: number;
  queryTracker?: QueryTracker;
  resultRedactor?: ResultRedactor;
  maxConcurrentQueries?: number;
  maxQueuedQueries?: number;
  queueTimeoutMs?: number;
};

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

  async explain(sql: string, ctx: SessionContext): Promise<ExplainResult> {
    const queryId = this.queryIdGenerator();
    const startedAt = this.now();
    const session = await this.connectionPool.acquire(ctx.datasource, "ro", {
      database: ctx.database,
    });
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
      await cancelTimedOutSession(session, error);
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
    const maxResultBytes = opts.maxResultBytes ?? ctx.limits.maxResultBytes ?? 1048576;
    const maxBlobBytes = opts.maxBlobBytes ?? ctx.limits.maxBlobBytes ?? 65536;
    const timeoutMs = opts.timeoutMs ?? ctx.limits.timeoutMs;

    const session = await this.connectionPool.acquire(ctx.datasource, "ro", {
      database: ctx.database,
    });
    const active = this.beginQuery(queryId, session, ctx, "ro", startedAt);

    try {
      const executionSql = buildServerBoundedReadonlySql(sql, maxRows);
      const result = await session.execute(executionSql, { timeoutMs });
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
          maxResultBytes,
          maxBlobBytes,
          maskAllColumns: opts.maskAllColumns,
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
        byteTruncated: redacted.byteTruncated,
        returnedBytes: redacted.returnedBytes,
        redactedColumns: redacted.redactedColumns,
        droppedColumns: redacted.droppedColumns,
        truncatedColumns: redacted.truncatedColumns,
        durationMs,
      };
    } catch (error) {
      await cancelTimedOutSession(session, error);
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

    const session = await this.connectionPool.acquire(ctx.datasource, "rw", {
      database: ctx.database,
    });
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
      if (isTimeoutError(error)) {
        await cancelTimedOutSession(session, error);
      } else {
        try {
          await session.execute("ROLLBACK", { timeoutMs });
        } catch {
          // Ignore rollback failure and keep original error.
        }
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
  const executor = new SqlExecutorImpl(options);
  const limiter = new QueryConcurrencyLimiter(
    options.maxConcurrentQueries ?? 8,
    options.maxQueuedQueries ?? 32,
    options.queueTimeoutMs ?? 5000,
  );
  return {
    explain: (sql, ctx) => limiter.run(() => executor.explain(sql, ctx)),
    executeReadonly: (sql, ctx, opts) =>
      limiter.run(() => executor.executeReadonly(sql, ctx, opts)),
    executeMutation: (sql, ctx, opts) =>
      limiter.run(() => executor.executeMutation(sql, ctx, opts)),
    getQueryStatus: (queryId) => executor.getQueryStatus(queryId),
    cancelQuery: (queryId) => executor.cancelQuery(queryId),
  };
}
