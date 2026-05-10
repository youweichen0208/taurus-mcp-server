import type { QueryResult } from "../../executor/sql-executor.js";
import type {
  DeadlockSummary,
  LockWaitRow,
  MetadataLockRow,
  ProcesslistRow,
  ReplicationStatusRow,
  StatementDigestRow,
  StatementWaitEventRow,
  TableStorageRow,
} from "./types.js";

export function parseProcesslistRows(result: QueryResult): ProcesslistRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    const timeValue = mapped.time_seconds;
    return {
      sessionId:
        mapped.session_id === undefined ? undefined : String(mapped.session_id),
      user: typeof mapped.user === "string" ? mapped.user : undefined,
      host: typeof mapped.host === "string" ? mapped.host : undefined,
      databaseName:
        typeof mapped.database_name === "string"
          ? mapped.database_name
          : undefined,
      command: typeof mapped.command === "string" ? mapped.command : undefined,
      timeSeconds:
        typeof timeValue === "number"
          ? timeValue
          : typeof timeValue === "string" && timeValue.trim().length > 0
            ? Number.parseInt(timeValue, 10)
            : undefined,
      state: typeof mapped.state === "string" ? mapped.state : undefined,
      infoPreview:
        typeof mapped.info_preview === "string"
          ? mapped.info_preview
          : undefined,
    };
  });
}

export function parseOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseInt(value, 10)
      : undefined;
}

export function parseLockWaitRows(result: QueryResult): LockWaitRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    return {
      waitingSessionId:
        mapped.waiting_session_id === undefined
          ? undefined
          : String(mapped.waiting_session_id),
      waitingUser:
        typeof mapped.waiting_user === "string"
          ? mapped.waiting_user
          : undefined,
      waitingState:
        typeof mapped.waiting_state === "string"
          ? mapped.waiting_state
          : undefined,
      waitingTrxState:
        typeof mapped.waiting_trx_state === "string"
          ? mapped.waiting_trx_state
          : undefined,
      waitAgeSeconds: parseOptionalInteger(mapped.wait_age_seconds),
      blockingSessionId:
        mapped.blocking_session_id === undefined
          ? undefined
          : String(mapped.blocking_session_id),
      blockingUser:
        typeof mapped.blocking_user === "string"
          ? mapped.blocking_user
          : undefined,
      blockingState:
        typeof mapped.blocking_state === "string"
          ? mapped.blocking_state
          : undefined,
      blockingTrxState:
        typeof mapped.blocking_trx_state === "string"
          ? mapped.blocking_trx_state
          : undefined,
      blockingTrxAgeSeconds: parseOptionalInteger(
        mapped.blocking_trx_age_seconds,
      ),
      lockedSchema:
        typeof mapped.locked_schema === "string"
          ? mapped.locked_schema
          : undefined,
      lockedTable:
        typeof mapped.locked_table === "string"
          ? mapped.locked_table
          : undefined,
      lockedIndex:
        typeof mapped.locked_index === "string"
          ? mapped.locked_index
          : undefined,
      waitingLockType:
        typeof mapped.waiting_lock_type === "string"
          ? mapped.waiting_lock_type
          : undefined,
      waitingLockMode:
        typeof mapped.waiting_lock_mode === "string"
          ? mapped.waiting_lock_mode
          : undefined,
      blockingLockType:
        typeof mapped.blocking_lock_type === "string"
          ? mapped.blocking_lock_type
          : undefined,
      blockingLockMode:
        typeof mapped.blocking_lock_mode === "string"
          ? mapped.blocking_lock_mode
          : undefined,
      waitingQuery:
        typeof mapped.waiting_query === "string"
          ? mapped.waiting_query
          : undefined,
      blockingQuery:
        typeof mapped.blocking_query === "string"
          ? mapped.blocking_query
          : undefined,
    };
  });
}

export function isIdleTransactionBlocker(row: LockWaitRow): boolean {
  return (
    row.blockingSessionId !== undefined &&
    row.blockingTrxState !== undefined &&
    (row.blockingState === undefined || row.blockingState === "Sleep")
  );
}

export function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseFloat(value)
      : undefined;
}

export function parseMetadataLockRows(result: QueryResult): MetadataLockRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    return {
      waitingSessionId:
        mapped.waiting_session_id === undefined
          ? undefined
          : String(mapped.waiting_session_id),
      waitingUser:
        typeof mapped.waiting_user === "string"
          ? mapped.waiting_user
          : undefined,
      waitingState:
        typeof mapped.waiting_state === "string"
          ? mapped.waiting_state
          : undefined,
      blockingSessionId:
        mapped.blocking_session_id === undefined
          ? undefined
          : String(mapped.blocking_session_id),
      blockingUser:
        typeof mapped.blocking_user === "string"
          ? mapped.blocking_user
          : undefined,
      blockingState:
        typeof mapped.blocking_state === "string"
          ? mapped.blocking_state
          : undefined,
      objectType:
        typeof mapped.object_type === "string" ? mapped.object_type : undefined,
      objectSchema:
        typeof mapped.object_schema === "string"
          ? mapped.object_schema
          : undefined,
      objectName:
        typeof mapped.object_name === "string" ? mapped.object_name : undefined,
      waitingLockType:
        typeof mapped.waiting_lock_type === "string"
          ? mapped.waiting_lock_type
          : undefined,
      waitingLockDuration:
        typeof mapped.waiting_lock_duration === "string"
          ? mapped.waiting_lock_duration
          : undefined,
      blockingLockType:
        typeof mapped.blocking_lock_type === "string"
          ? mapped.blocking_lock_type
          : undefined,
      blockingLockDuration:
        typeof mapped.blocking_lock_duration === "string"
          ? mapped.blocking_lock_duration
          : undefined,
    };
  });
}

export function parseDeadlockSummary(result: QueryResult): DeadlockSummary | undefined {
  const statusColumnIndex = result.columns.findIndex(
    (column) => column.name.toLowerCase() === "status",
  );
  if (statusColumnIndex < 0 || result.rows.length === 0) {
    return undefined;
  }
  const statusValue = result.rows[0]?.[statusColumnIndex];
  if (typeof statusValue !== "string" || !statusValue.includes("DEADLOCK")) {
    return undefined;
  }

  const startIndex = statusValue.indexOf("LATEST DETECTED DEADLOCK");
  if (startIndex < 0) {
    return undefined;
  }
  const deadlockText = statusValue.slice(startIndex);
  const lines = deadlockText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-*]{3,}$/.test(line));

  const detectedAt = lines.find((line) => /^\d{4}-\d{2}-\d{2}/.test(line));
  const transactionIds = Array.from(
    new Set(
      [...deadlockText.matchAll(/TRANSACTION\s+(\d+)/g)].map(
        (match) => match[1],
      ),
    ),
  );
  const tableRefs = Array.from(
    new Set(
      [...deadlockText.matchAll(/table\s+`([^`]+)`\.`([^`]+)`/gi)].map(
        (match) => `${match[1]}.${match[2]}`,
      ),
    ),
  );
  const summaryLines = lines
    .filter(
      (line) =>
        !line.startsWith("LATEST DETECTED DEADLOCK") &&
        !/^\d{4}-\d{2}-\d{2}/.test(line),
    )
    .slice(0, 3);

  return {
    detectedAt,
    summary:
      summaryLines.join(" ").slice(0, 400) ||
      "InnoDB reported a recent deadlock in SHOW ENGINE INNODB STATUS.",
    waitingTables: tableRefs,
    blockingTables: tableRefs,
    transactionIds,
  };
}

export function parseStatementDigestRows(result: QueryResult): StatementDigestRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    return {
      schemaName:
        typeof mapped.schema_name === "string" ? mapped.schema_name : undefined,
      digest: typeof mapped.digest === "string" ? mapped.digest : undefined,
      digestText:
        typeof mapped.digest_text === "string" ? mapped.digest_text : undefined,
      querySampleText:
        typeof mapped.query_sample_text === "string"
          ? mapped.query_sample_text
          : undefined,
      execCount: parseOptionalInteger(mapped.exec_count),
      avgLatencyMs: parseOptionalNumber(mapped.avg_latency_ms),
      totalLatencyMs: parseOptionalNumber(mapped.total_latency_ms),
      maxLatencyMs: parseOptionalNumber(mapped.max_latency_ms),
      avgLockTimeMs: parseOptionalNumber(mapped.avg_lock_time_ms),
      avgRowsExamined: parseOptionalNumber(mapped.avg_rows_examined),
      avgSortRows: parseOptionalNumber(mapped.avg_sort_rows),
      avgTmpTables: parseOptionalNumber(mapped.avg_tmp_tables),
      avgTmpDiskTables: parseOptionalNumber(mapped.avg_tmp_disk_tables),
      selectScanCount: parseOptionalInteger(mapped.select_scan_count),
      noIndexUsedCount: parseOptionalInteger(mapped.no_index_used_count),
    };
  });
}

export function parseStatementWaitEventRows(
  result: QueryResult,
): StatementWaitEventRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    return {
      eventName:
        typeof mapped.event_name === "string" ? mapped.event_name : undefined,
      sampleCount: parseOptionalInteger(mapped.sample_count),
      statementCount: parseOptionalInteger(mapped.statement_count),
      totalWaitMs: parseOptionalNumber(mapped.total_wait_ms),
      avgWaitMs: parseOptionalNumber(mapped.avg_wait_ms),
    };
  });
}

export function parseTableStorageRows(result: QueryResult): TableStorageRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows.map((row) => {
    const mapped = Object.fromEntries(
      columns.map((name, index) => [name, row[index]]),
    );

    return {
      schemaName:
        typeof mapped.schema_name === "string" ? mapped.schema_name : undefined,
      tableName:
        typeof mapped.table_name === "string" ? mapped.table_name : undefined,
      engine: typeof mapped.engine === "string" ? mapped.engine : undefined,
      rowCountEstimate: parseOptionalInteger(mapped.row_count_estimate),
      totalMb: parseOptionalNumber(mapped.total_mb),
      dataMb: parseOptionalNumber(mapped.data_mb),
      indexMb: parseOptionalNumber(mapped.index_mb),
      dataFreeMb: parseOptionalNumber(mapped.data_free_mb),
    };
  });
}

export function parseReplicationStatusRows(
  result: QueryResult,
): ReplicationStatusRow[] {
  const columns = result.columns.map((column) => column.name);
  return result.rows
    .map((row) => {
      const mapped = Object.fromEntries(
        columns.map((name, index) => [name, row[index]]),
      );

      const parsed = {
        channelName:
          typeof mapped.Channel_Name === "string"
            ? mapped.Channel_Name
            : typeof mapped.channel_name === "string"
              ? mapped.channel_name
              : undefined,
        replicaIoRunning:
          typeof mapped.Replica_IO_Running === "string"
            ? mapped.Replica_IO_Running
            : typeof mapped.Slave_IO_Running === "string"
              ? mapped.Slave_IO_Running
              : undefined,
        replicaSqlRunning:
          typeof mapped.Replica_SQL_Running === "string"
            ? mapped.Replica_SQL_Running
            : typeof mapped.Slave_SQL_Running === "string"
              ? mapped.Slave_SQL_Running
              : undefined,
        secondsBehindSource:
          parseOptionalNumber(mapped.Seconds_Behind_Source) ??
          parseOptionalNumber(mapped.Seconds_Behind_Master),
        retrievedGtidSet:
          typeof mapped.Retrieved_Gtid_Set === "string"
            ? mapped.Retrieved_Gtid_Set
            : undefined,
        executedGtidSet:
          typeof mapped.Executed_Gtid_Set === "string"
            ? mapped.Executed_Gtid_Set
            : undefined,
        lastIoError:
          typeof mapped.Last_IO_Error === "string" &&
          mapped.Last_IO_Error.length > 0
            ? mapped.Last_IO_Error
            : undefined,
        lastSqlError:
          typeof mapped.Last_SQL_Error === "string" &&
          mapped.Last_SQL_Error.length > 0
            ? mapped.Last_SQL_Error
            : undefined,
      };
      return parsed;
    })
    .filter(
      (row) =>
        row.channelName !== undefined ||
        row.replicaIoRunning !== undefined ||
        row.replicaSqlRunning !== undefined ||
        row.secondsBehindSource !== undefined ||
        row.lastIoError !== undefined ||
        row.lastSqlError !== undefined,
    );
}
