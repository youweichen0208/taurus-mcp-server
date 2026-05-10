import type { TaurusApiCandidate } from "./types.js";
import { parseDurationMs, readNumber, readString, secondsToMs } from "./utils.js";

export function pickArrayCandidate(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  for (const key of [
    "slow_log_list",
    "slow_log_statistics",
    "slow_log_statistic_list",
    "items",
    "records",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      );
    }
  }
  return [];
}

export function parseStatisticsCandidate(item: Record<string, unknown>, rawRef: string): TaurusApiCandidate | undefined {
  const sql = readString(item.query_sample) ?? readString(item.sql_statement);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database: readString(item.database),
    user: readString(item.users) ?? readString(item.user),
    clientIp: readString(item.client_ip),
    startTime: readString(item.start_at) ?? readString(item.time),
    execCount: readNumber(item.count),
    avgLatencyMs: parseDurationMs(item.execute_time) ?? parseDurationMs(item.avg_query_time),
    avgLockTimeMs: parseDurationMs(item.lock_time),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

export function parseDetailCandidate(item: Record<string, unknown>, rawRef: string): TaurusApiCandidate | undefined {
  const sql = readString(item.query_sample) ?? readString(item.sql_statement);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database: readString(item.database),
    user: readString(item.user),
    clientIp: readString(item.client_ip),
    startTime: readString(item.start_at) ?? readString(item.time),
    execCount: 1,
    avgLatencyMs: parseDurationMs(item.query_time) ?? parseDurationMs(item.execute_time),
    avgLockTimeMs: parseDurationMs(item.lock_time),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

export function parseDasSlowLogCandidate(
  item: Record<string, unknown>,
  rawRef: string,
): TaurusApiCandidate | undefined {
  const sql =
    readString(item.sql) ??
    readString(item.query) ??
    readString(item.sql_statement) ??
    readString(item.template);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database:
      readString(item.database) ??
      readString(item.db_name) ??
      readString(item.databases),
    user: readString(item.users) ?? readString(item.user),
    clientIp: readString(item.client_ip),
    startTime:
      readString(item.start_at) ??
      readString(item.time) ??
      readString(item.timestamp),
    execCount: readNumber(item.count) ?? 1,
    avgLatencyMs:
      secondsToMs(item.query_time) ??
      parseDurationMs(item.query_time_ms) ??
      secondsToMs(item.avg_query_time),
    avgLockTimeMs:
      secondsToMs(item.lock_time) ?? parseDurationMs(item.lock_time_ms),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

export function parseDasSqlStatementCandidate(
  item: Record<string, unknown>,
  rawRef: string,
): TaurusApiCandidate | undefined {
  const sql =
    readString(item.sql) ??
    readString(item.sql_statement) ??
    readString(item.query);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database:
      readString(item.database) ??
      readString(item.db_name) ??
      readString(item.schema_name),
    user: readString(item.user) ?? readString(item.users),
    clientIp: readString(item.client_ip),
    startTime:
      readString(item.start_at) ??
      readString(item.time) ??
      readString(item.timestamp),
    execCount: 1,
    avgLatencyMs:
      parseDurationMs(item.query_time) ??
      secondsToMs(item.query_time_second) ??
      parseDurationMs(item.duration),
    avgLockTimeMs:
      parseDurationMs(item.lock_time) ?? secondsToMs(item.lock_time_second),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

export function pickDasTopSlowArrays(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const arrays = [
    payload.top_execute_slow_logs,
    payload.top_avg_query_time_slow_logs,
    payload.top_max_query_time_slow_logs,
    payload.top_returned_rows_slow_logs,
    payload.top_rows_examined_slow_logs,
  ];
  return arrays.flatMap((value) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === "object" && !Array.isArray(item),
        )
      : [],
  );
}
