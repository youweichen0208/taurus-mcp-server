import { generateQueryId } from "../utils/id.js";
import { buildExplainRecommendations, normalizeExplainRows, summarizeExplainRows, } from "./explain.js";
import { createQueryTracker, } from "./query-tracker.js";
import { createResultRedactor, } from "../safety/redaction.js";
function asFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function inferColumns(raw, rows) {
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
function normalizeRows(rows, columns) {
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
export class SqlExecutorImpl {
    connectionPool;
    now;
    queryIdGenerator;
    queryTracker;
    resultRedactor;
    activeSessions = new Map();
    constructor(options) {
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
    async explainForGuardrail(sql, ctx) {
        const session = await this.connectionPool.acquire(ctx.datasource, "ro");
        try {
            const result = await session.execute(`EXPLAIN ${sql}`, {
                timeoutMs: ctx.limits.timeoutMs,
            });
            const rows = normalizeExplainRows(result);
            return summarizeExplainRows(rows);
        }
        finally {
            await this.connectionPool.release(session);
        }
    }
    async explain(sql, ctx) {
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
        }
        catch (error) {
            const durationMs = this.now() - startedAt;
            this.completeQuery(active.queryId, active.cancelRequested ? "cancelled" : "failed", durationMs, error);
            throw error;
        }
        finally {
            await this.endQuerySession(active.queryId);
        }
    }
    async executeReadonly(sql, ctx, opts = {}) {
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
            const redacted = this.resultRedactor.redact({
                columns,
                rows: normalizedRows,
                rowCount,
            }, {
                maxRows,
                maxColumns,
                maxFieldChars,
                sensitiveColumns: opts.sensitiveColumns,
                sensitiveStrategy: opts.sensitiveStrategy,
            });
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
        }
        catch (error) {
            const durationMs = this.now() - startedAt;
            this.completeQuery(active.queryId, active.cancelRequested ? "cancelled" : "failed", durationMs, error);
            throw error;
        }
        finally {
            await this.endQuerySession(active.queryId);
        }
    }
    async executeMutation(sql, ctx, opts = {}) {
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
            const affectedRows = asFiniteNumber(result.affectedRows) ??
                asFiniteNumber(result.rowCount) ??
                0;
            const durationMs = this.now() - startedAt;
            this.completeQuery(active.queryId, "completed", durationMs);
            return {
                queryId,
                affectedRows,
                durationMs,
            };
        }
        catch (error) {
            try {
                await session.execute("ROLLBACK", { timeoutMs });
            }
            catch {
                // Ignore rollback failure and keep original error.
            }
            const durationMs = this.now() - startedAt;
            this.completeQuery(active.queryId, active.cancelRequested ? "cancelled" : "failed", durationMs, error);
            throw error;
        }
        finally {
            await this.endQuerySession(active.queryId);
        }
    }
    async getQueryStatus(queryId) {
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
    async cancelQuery(queryId) {
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
        }
        catch (error) {
            const now = this.now();
            this.completeQuery(queryId, "failed", now - active.startedAt, error);
            return {
                queryId,
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
    beginQuery(queryId, session, ctx, mode, startedAt) {
        const active = {
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
    completeQuery(queryId, status, durationMs, error) {
        const info = this.queryTracker.get(queryId);
        if (!info) {
            return;
        }
        const endedAt = info.startedAt + durationMs;
        const errorMessage = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
        this.queryTracker.markCompleted(queryId, {
            status,
            endedAt,
            durationMs,
            error: errorMessage,
        });
    }
    async endQuerySession(queryId) {
        const active = this.activeSessions.get(queryId);
        if (!active) {
            return;
        }
        this.activeSessions.delete(queryId);
        await this.connectionPool.release(active.session);
    }
}
export function createSqlExecutor(options) {
    return new SqlExecutorImpl(options);
}
