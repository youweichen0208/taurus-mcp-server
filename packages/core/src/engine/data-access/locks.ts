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

export async function showLockWaits(
  engine: TaurusDBEngine,
  input: ShowLockWaitsInput,
  ctx: SessionContext,
): Promise<QueryResult> {
    const maxRows = clampInteger(input.maxRows, 20, 1, 100);
    const includeSql = input.includeSql === true;
    const sqlMaxChars = clampInteger(input.sqlMaxChars, 256, 32, 2048);

    const selectedColumns = [
      "CAST(waiting_thread.PROCESSLIST_ID AS CHAR) AS waiting_session_id",
      "waiting_thread.PROCESSLIST_USER AS waiting_user",
      "waiting_thread.PROCESSLIST_STATE AS waiting_state",
      "waiting_trx.TRX_STATE AS waiting_trx_state",
      "TIMESTAMPDIFF(SECOND, waiting_trx.TRX_WAIT_STARTED, CURRENT_TIMESTAMP) AS wait_age_seconds",
      "CAST(blocking_thread.PROCESSLIST_ID AS CHAR) AS blocking_session_id",
      "blocking_thread.PROCESSLIST_USER AS blocking_user",
      "blocking_thread.PROCESSLIST_STATE AS blocking_state",
      "blocking_trx.TRX_STATE AS blocking_trx_state",
      "TIMESTAMPDIFF(SECOND, blocking_trx.TRX_STARTED, CURRENT_TIMESTAMP) AS blocking_trx_age_seconds",
      "requesting_lock.OBJECT_SCHEMA AS locked_schema",
      "requesting_lock.OBJECT_NAME AS locked_table",
      "requesting_lock.INDEX_NAME AS locked_index",
      "requesting_lock.LOCK_TYPE AS waiting_lock_type",
      "requesting_lock.LOCK_MODE AS waiting_lock_mode",
      "blocking_lock.LOCK_TYPE AS blocking_lock_type",
      "blocking_lock.LOCK_MODE AS blocking_lock_mode",
    ];
    if (includeSql) {
      selectedColumns.push(
        "waiting_thread.PROCESSLIST_INFO AS waiting_query",
        "blocking_thread.PROCESSLIST_INFO AS blocking_query",
      );
    }

    const whereClauses = ["waits.ENGINE = 'INNODB'"];
    const targetSchema = ctx.database;
    if (targetSchema) {
      whereClauses.push(
        `requesting_lock.OBJECT_SCHEMA = ${quoteLiteral(targetSchema)}`,
      );
    }
    if (input.table) {
      whereClauses.push(
        `requesting_lock.OBJECT_NAME = ${quoteLiteral(input.table)}`,
      );
    }
    if (input.blockerSessionId) {
      whereClauses.push(
        `CAST(blocking_thread.PROCESSLIST_ID AS CHAR) = ${quoteLiteral(input.blockerSessionId)}`,
      );
    }

    const sql = `
      SELECT ${selectedColumns.join(", ")}
      FROM performance_schema.data_lock_waits AS waits
      INNER JOIN performance_schema.data_locks AS requesting_lock
        ON requesting_lock.ENGINE = waits.ENGINE
        AND requesting_lock.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
      INNER JOIN performance_schema.data_locks AS blocking_lock
        ON blocking_lock.ENGINE = waits.ENGINE
        AND blocking_lock.ENGINE_LOCK_ID = waits.BLOCKING_ENGINE_LOCK_ID
      LEFT JOIN information_schema.INNODB_TRX AS waiting_trx
        ON waiting_trx.TRX_ID = waits.REQUESTING_ENGINE_TRANSACTION_ID
      LEFT JOIN information_schema.INNODB_TRX AS blocking_trx
        ON blocking_trx.TRX_ID = waits.BLOCKING_ENGINE_TRANSACTION_ID
      LEFT JOIN performance_schema.threads AS waiting_thread
        ON waiting_thread.THREAD_ID = waits.REQUESTING_THREAD_ID
      LEFT JOIN performance_schema.threads AS blocking_thread
        ON blocking_thread.THREAD_ID = waits.BLOCKING_THREAD_ID
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY wait_age_seconds DESC, blocking_trx_age_seconds DESC, blocking_session_id DESC
      LIMIT ${maxRows}
    `.trim();

    return engine.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: selectedColumns.length,
      maxFieldChars: includeSql ? sqlMaxChars : 256,
      timeoutMs: ctx.limits.timeoutMs,
    });
  }

export async function findMetadataLockWaits(
  engine: TaurusDBEngine,
  input: DiagnoseLockContentionInput,
  ctx: SessionContext,
): Promise<MetadataLockRow[]> {
    const maxRows = lockEvidenceRowLimit(input.evidenceLevel);
    const whereClauses = [
      "waiting.LOCK_STATUS = 'PENDING'",
      "blocking.LOCK_STATUS = 'GRANTED'",
      "waiting.OWNER_THREAD_ID <> blocking.OWNER_THREAD_ID",
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
      whereClauses.push(
        `waiting.OBJECT_SCHEMA = ${quoteLiteral(focusedTable.schema)}`,
      );
    }
    if (focusedTable.table) {
      whereClauses.push(
        `waiting.OBJECT_NAME = ${quoteLiteral(focusedTable.table)}`,
      );
    }
    if (input.blockerSessionId) {
      whereClauses.push(
        `blocking_threads.PROCESSLIST_ID = ${quoteLiteral(input.blockerSessionId)}`,
      );
    }

    const sql = `
      SELECT
        waiting_threads.PROCESSLIST_ID AS waiting_session_id,
        waiting_threads.PROCESSLIST_USER AS waiting_user,
        waiting_threads.PROCESSLIST_STATE AS waiting_state,
        blocking_threads.PROCESSLIST_ID AS blocking_session_id,
        blocking_threads.PROCESSLIST_USER AS blocking_user,
        blocking_threads.PROCESSLIST_STATE AS blocking_state,
        waiting.OBJECT_TYPE AS object_type,
        waiting.OBJECT_SCHEMA AS object_schema,
        waiting.OBJECT_NAME AS object_name,
        waiting.LOCK_TYPE AS waiting_lock_type,
        waiting.LOCK_DURATION AS waiting_lock_duration,
        blocking.LOCK_TYPE AS blocking_lock_type,
        blocking.LOCK_DURATION AS blocking_lock_duration
      FROM performance_schema.metadata_locks AS waiting
      INNER JOIN performance_schema.threads AS waiting_threads
        ON waiting_threads.THREAD_ID = waiting.OWNER_THREAD_ID
      INNER JOIN performance_schema.metadata_locks AS blocking
        ON blocking.OBJECT_TYPE = waiting.OBJECT_TYPE
        AND COALESCE(blocking.OBJECT_SCHEMA, '') = COALESCE(waiting.OBJECT_SCHEMA, '')
        AND COALESCE(blocking.OBJECT_NAME, '') = COALESCE(waiting.OBJECT_NAME, '')
      INNER JOIN performance_schema.threads AS blocking_threads
        ON blocking_threads.THREAD_ID = blocking.OWNER_THREAD_ID
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY waiting.OBJECT_SCHEMA ASC, waiting.OBJECT_NAME ASC, blocking_threads.PROCESSLIST_ID ASC
      LIMIT ${maxRows}
    `.trim();

    try {
      const result = await engine.executor.executeReadonly(sql, ctx, {
        maxRows,
        maxColumns: 13,
        maxFieldChars: 512,
        timeoutMs: ctx.limits.timeoutMs,
      });
      return parseMetadataLockRows(result);
    } catch {
      return [];
    }
  }

export async function findLatestDeadlock(
  engine: TaurusDBEngine,
  ctx: SessionContext,
  ): Promise<DeadlockSummary | undefined> {
    try {
      const result = await engine.executor.executeReadonly(
        "SHOW ENGINE INNODB STATUS",
        ctx,
        {
          maxRows: 1,
          maxColumns: 3,
          maxFieldChars: 32768,
          timeoutMs: ctx.limits.timeoutMs,
        },
      );
      return parseDeadlockSummary(result);
    } catch {
      return undefined;
    }
  }
