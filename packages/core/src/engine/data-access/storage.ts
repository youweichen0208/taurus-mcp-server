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

export async function findStorageStatementDigests(
  engine: TaurusDBEngine,
  input: DiagnoseStoragePressureInput,
  ctx: SessionContext,
): Promise<StatementDigestRow[]> {
    const maxRows = Math.min(
      clampInteger(input.maxCandidates, 5, 1, 10) * 2,
      20,
    );
    const whereClauses = ["DIGEST_TEXT IS NOT NULL", "DIGEST_TEXT <> 'NULL'"];
    const focusedTable = input.table?.includes(".")
      ? input.table.split(".").slice(1).join(".")
      : input.table;

    if (ctx.database) {
      whereClauses.push(`SCHEMA_NAME = ${quoteLiteral(ctx.database)}`);
    }
    if (focusedTable) {
      const tableLike = quoteLiteral(`%${escapeLikePrefix(focusedTable)}%`);
      whereClauses.push(
        `(DIGEST_TEXT LIKE ${tableLike} ESCAPE '\\\\' OR QUERY_SAMPLE_TEXT LIKE ${tableLike} ESCAPE '\\\\')`,
      );
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
      ORDER BY
        SUM_CREATED_TMP_DISK_TABLES DESC,
        SUM_ROWS_EXAMINED DESC,
        SUM_SORT_ROWS DESC,
        SUM_TIMER_WAIT DESC,
        COUNT_STAR DESC
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

export async function findTableStorageStats(
  engine: TaurusDBEngine,
  input: DiagnoseStoragePressureInput,
  ctx: SessionContext,
): Promise<TableStorageRow[]> {
    const maxRows = clampInteger(input.maxCandidates, 5, 1, 10);
    const whereClauses = [
      "TABLE_TYPE = 'BASE TABLE'",
      "TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')",
    ];
    const focusedTable = input.table?.includes(".")
      ? {
          schema: input.table.split(".")[0],
          table: input.table.split(".").slice(1).join("."),
        }
      : {
          schema: ctx.database,
          table: input.table,
        };

    if (focusedTable.schema) {
      whereClauses.push(`TABLE_SCHEMA = ${quoteLiteral(focusedTable.schema)}`);
    } else if (ctx.database && input.scope !== "instance") {
      whereClauses.push(`TABLE_SCHEMA = ${quoteLiteral(ctx.database)}`);
    }
    if (focusedTable.table) {
      whereClauses.push(`TABLE_NAME = ${quoteLiteral(focusedTable.table)}`);
    }

    const sql = `
      SELECT
        TABLE_SCHEMA AS schema_name,
        TABLE_NAME AS table_name,
        ENGINE AS engine,
        TABLE_ROWS AS row_count_estimate,
        ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 3) AS total_mb,
        ROUND(DATA_LENGTH / 1024 / 1024, 3) AS data_mb,
        ROUND(INDEX_LENGTH / 1024 / 1024, 3) AS index_mb,
        ROUND(DATA_FREE / 1024 / 1024, 3) AS data_free_mb
      FROM information_schema.TABLES
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC, TABLE_ROWS DESC, TABLE_SCHEMA ASC, TABLE_NAME ASC
      LIMIT ${maxRows}
    `.trim();

    const result = await engine.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: 8,
      maxFieldChars: 512,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseTableStorageRows(result);
  }
