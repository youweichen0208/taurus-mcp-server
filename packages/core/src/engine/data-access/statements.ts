import type { SessionContext } from "../../context/session-context.js";
import type { DiagnoseLockContentionInput, DiagnoseStoragePressureInput, FindTopSlowSqlInput } from "../../diagnostics/types.js";
import type { QueryResult } from "../../executor/sql-executor.js";
import type { ShowLockWaitsInput, ShowProcesslistInput, TaurusDBEngine } from "../../engine.js";
import {
  clampInteger,
  digestMatchScore,
  escapeLikePrefix,
  extractSqlTableNameHints,
  lockEvidenceRowLimit,
  parseDeadlockSummary,
  parseMetadataLockRows,
  parseStatementDigestRows,
  parseStatementWaitEventRows,
  parseTableStorageRows,
  quoteLiteral,
  topSlowSqlOrderBy,
  type DeadlockSummary,
  type MetadataLockRow,
  type StatementDigestRow,
  type StatementWaitEventRow,
  type TableStorageRow,
} from "../helpers.js";

export async function findStatementDigestSample(
  engine: TaurusDBEngine,
  digestText: string,
  ctx: SessionContext,
): Promise<StatementDigestRow | undefined> {
    const whereClauses = [`DIGEST_TEXT = ${quoteLiteral(digestText)}`];
    if (ctx.database) {
      whereClauses.push(`SCHEMA_NAME = ${quoteLiteral(ctx.database)}`);
    }

    const sql = `
      SELECT
        SCHEMA_NAME AS schema_name,
        DIGEST AS digest,
        DIGEST_TEXT AS digest_text,
        QUERY_SAMPLE_TEXT AS query_sample_text,
        COUNT_STAR AS exec_count,
        ROUND(AVG_TIMER_WAIT / 1000000000, 3) AS avg_latency_ms,
        ROUND(SUM_TIMER_WAIT / 1000000000, 3) AS total_latency_ms,
        ROUND(MAX_TIMER_WAIT / 1000000000, 3) AS max_latency_ms,
        ROUND(SUM_LOCK_TIME / 1000000000 / NULLIF(COUNT_STAR, 0), 3) AS avg_lock_time_ms,
        ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0), 3) AS avg_rows_examined,
        ROUND(SUM_SORT_ROWS / NULLIF(COUNT_STAR, 0), 3) AS avg_sort_rows,
        ROUND(SUM_CREATED_TMP_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_tables,
        ROUND(SUM_CREATED_TMP_DISK_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_disk_tables,
        SUM_SELECT_SCAN AS select_scan_count,
        SUM_NO_INDEX_USED AS no_index_used_count
      FROM performance_schema.events_statements_summary_by_digest
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY SUM_TIMER_WAIT DESC, COUNT_STAR DESC
      LIMIT 1
    `.trim();

    const result = await engine.executor.executeReadonly(sql, ctx, {
      maxRows: 1,
      maxColumns: 15,
      maxFieldChars: 2048,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result)[0];
  }

export async function findStatementDigestSampleForSql(
  engine: TaurusDBEngine,
  sql: string,
  ctx: SessionContext,
): Promise<StatementDigestRow | undefined> {
    const candidates = await engine.findTopStatementDigests(
      {
        database: ctx.database,
        topN: 20,
        sortBy: "total_latency",
      },
      ctx,
    );

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: digestMatchScore(sql, candidate),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.candidate.totalLatencyMs ?? 0) -
            (left.candidate.totalLatencyMs ?? 0) ||
          (right.candidate.execCount ?? 0) - (left.candidate.execCount ?? 0),
      );
    if (ranked[0]?.candidate) {
      return ranked[0].candidate;
    }

    const hintCandidates = await engine.findStatementDigestCandidatesForSqlHints(
      sql,
      ctx,
    ).catch(() => [] as StatementDigestRow[]);
    return hintCandidates
      .map((candidate) => ({
        candidate,
        score: digestMatchScore(sql, candidate),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.candidate.totalLatencyMs ?? 0) -
            (left.candidate.totalLatencyMs ?? 0) ||
          (right.candidate.execCount ?? 0) - (left.candidate.execCount ?? 0),
      )[0]?.candidate;
  }

export async function findStatementDigestCandidatesForSqlHints(
  engine: TaurusDBEngine,
  sqlText: string,
  ctx: SessionContext,
): Promise<StatementDigestRow[]> {
    const tableHints = extractSqlTableNameHints(sqlText).slice(0, 3);
    if (tableHints.length === 0) {
      return [];
    }

    const whereClauses = ["DIGEST_TEXT IS NOT NULL", "DIGEST_TEXT <> 'NULL'"];
    if (ctx.database) {
      whereClauses.push(`SCHEMA_NAME = ${quoteLiteral(ctx.database)}`);
    }
    const tableClauses = tableHints.map((table) => {
      const tableLike = quoteLiteral(`%${escapeLikePrefix(table)}%`);
      return `(DIGEST_TEXT LIKE ${tableLike} ESCAPE '\\\\' OR QUERY_SAMPLE_TEXT LIKE ${tableLike} ESCAPE '\\\\')`;
    });
    whereClauses.push(`(${tableClauses.join(" OR ")})`);

    const sql = `
      SELECT
        SCHEMA_NAME AS schema_name,
        DIGEST AS digest,
        DIGEST_TEXT AS digest_text,
        QUERY_SAMPLE_TEXT AS query_sample_text,
        COUNT_STAR AS exec_count,
        ROUND(AVG_TIMER_WAIT / 1000000000, 3) AS avg_latency_ms,
        ROUND(SUM_TIMER_WAIT / 1000000000, 3) AS total_latency_ms,
        ROUND(MAX_TIMER_WAIT / 1000000000, 3) AS max_latency_ms,
        ROUND(SUM_LOCK_TIME / 1000000000 / NULLIF(COUNT_STAR, 0), 3) AS avg_lock_time_ms,
        ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0), 3) AS avg_rows_examined,
        ROUND(SUM_SORT_ROWS / NULLIF(COUNT_STAR, 0), 3) AS avg_sort_rows,
        ROUND(SUM_CREATED_TMP_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_tables,
        ROUND(SUM_CREATED_TMP_DISK_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_disk_tables,
        SUM_SELECT_SCAN AS select_scan_count,
        SUM_NO_INDEX_USED AS no_index_used_count
      FROM performance_schema.events_statements_summary_by_digest
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY SUM_TIMER_WAIT DESC, AVG_TIMER_WAIT DESC, COUNT_STAR DESC
      LIMIT 50
    `.trim();

    const result = await engine.executor.executeReadonly(sql, ctx, {
      maxRows: 50,
      maxColumns: 15,
      maxFieldChars: 4096,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result);
  }

export async function findTopStatementDigests(
  engine: TaurusDBEngine,
  input: FindTopSlowSqlInput,
  ctx: SessionContext,
): Promise<StatementDigestRow[]> {
    const maxRows = clampInteger(input.topN, 5, 1, 20);
    const whereClauses = ["DIGEST_TEXT IS NOT NULL", "DIGEST_TEXT <> 'NULL'"];
    if (ctx.database) {
      whereClauses.push(`SCHEMA_NAME = ${quoteLiteral(ctx.database)}`);
    }

    const sql = `
      SELECT
        SCHEMA_NAME AS schema_name,
        DIGEST AS digest,
        DIGEST_TEXT AS digest_text,
        QUERY_SAMPLE_TEXT AS query_sample_text,
        COUNT_STAR AS exec_count,
        ROUND(AVG_TIMER_WAIT / 1000000000, 3) AS avg_latency_ms,
        ROUND(SUM_TIMER_WAIT / 1000000000, 3) AS total_latency_ms,
        ROUND(MAX_TIMER_WAIT / 1000000000, 3) AS max_latency_ms,
        ROUND(SUM_LOCK_TIME / 1000000000 / NULLIF(COUNT_STAR, 0), 3) AS avg_lock_time_ms,
        ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0), 3) AS avg_rows_examined,
        ROUND(SUM_SORT_ROWS / NULLIF(COUNT_STAR, 0), 3) AS avg_sort_rows,
        ROUND(SUM_CREATED_TMP_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_tables,
        ROUND(SUM_CREATED_TMP_DISK_TABLES / NULLIF(COUNT_STAR, 0), 3) AS avg_tmp_disk_tables,
        SUM_SELECT_SCAN AS select_scan_count,
        SUM_NO_INDEX_USED AS no_index_used_count
      FROM performance_schema.events_statements_summary_by_digest
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${topSlowSqlOrderBy(input.sortBy)}
      LIMIT ${maxRows}
    `.trim();

    const result = await engine.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: 15,
      maxFieldChars: 4096,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result);
  }

export async function isPerformanceSchemaEnabled(
  engine: TaurusDBEngine,
  ctx: SessionContext,
  ): Promise<boolean | undefined> {
    try {
      const result = await engine.executor.executeReadonly(
        "SELECT @@performance_schema AS performance_schema_enabled",
        ctx,
        {
          maxRows: 1,
          maxColumns: 1,
          maxFieldChars: 64,
          timeoutMs: ctx.limits.timeoutMs,
        },
      );
      const value = result.rows?.[0]?.[0];
      if (typeof value === "number") {
        return value === 1;
      }
      if (typeof value === "string") {
        return value === "1" || value.toLowerCase() === "on";
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

export async function findStatementWaitEvents(
  engine: TaurusDBEngine,
  digestText: string,
  ctx: SessionContext,
): Promise<StatementWaitEventRow[]> {
    const whereClauses = [`stmt.DIGEST_TEXT = ${quoteLiteral(digestText)}`];
    if (ctx.database) {
      whereClauses.push(`stmt.CURRENT_SCHEMA = ${quoteLiteral(ctx.database)}`);
    }

    const sql = `
      SELECT
        waits.EVENT_NAME AS event_name,
        COUNT(*) AS sample_count,
        COUNT(DISTINCT CONCAT(stmt.THREAD_ID, ':', stmt.EVENT_ID)) AS statement_count,
        ROUND(SUM(waits.TIMER_WAIT) / 1000000000, 3) AS total_wait_ms,
        ROUND(AVG(waits.TIMER_WAIT) / 1000000000, 3) AS avg_wait_ms
      FROM performance_schema.events_statements_history_long AS stmt
      INNER JOIN performance_schema.events_waits_history_long AS waits
        ON waits.THREAD_ID = stmt.THREAD_ID
        AND waits.NESTING_EVENT_ID = stmt.EVENT_ID
        AND waits.NESTING_EVENT_TYPE = 'STATEMENT'
      WHERE ${whereClauses.join(" AND ")}
      GROUP BY waits.EVENT_NAME
      ORDER BY total_wait_ms DESC, sample_count DESC, event_name ASC
      LIMIT 3
    `.trim();

    try {
      const result = await engine.executor.executeReadonly(sql, ctx, {
        maxRows: 3,
        maxColumns: 5,
        maxFieldChars: 256,
        timeoutMs: ctx.limits.timeoutMs,
      });
      return parseStatementWaitEventRows(result);
    } catch {
      return [];
    }
  }
