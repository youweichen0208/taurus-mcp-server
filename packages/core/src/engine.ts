import {
  createSqlProfileLoader,
  type DataSourceProfile,
  type DatabaseEngine,
  type ProfileLoader,
} from "./auth/sql-profile-loader.js";
import {
  createSecretResolver,
  type SecretResolver,
} from "./auth/secret-resolver.js";
import {
  createCapabilityProbe,
  type CapabilityProbe,
} from "./capability/probe.js";
import { UnsupportedFeatureError } from "./capability/types.js";
import type {
  CapabilitySnapshot,
  FeatureMatrix,
  KernelInfo,
} from "./capability/types.js";
import { getConfig, type Config } from "./config/index.js";
import { createDatasourceResolver } from "./context/datasource-resolver.js";
import type {
  DatasourceResolveInput,
  DatasourceResolver,
  SessionContext,
} from "./context/session-context.js";
import {
  createConnectionPoolManager,
  type ConnectionPool,
} from "./executor/connection-pool.js";
import { createMySqlDriverAdapter } from "./executor/adapters/mysql.js";
import {
  createSqlExecutor,
  type CancelResult,
  type ExplainResult,
  type MutationOptions,
  type MutationResult,
  type QueryResult,
  type QueryStatus,
  type ReadonlyOptions,
  type SqlExecutor,
} from "./executor/sql-executor.js";
import {
  createConfirmationStore,
  InMemoryConfirmationStore,
  type ConfirmationStore,
  type ConfirmationToken,
  type ConfirmationValidationResult,
} from "./safety/confirmation-store.js";
import {
  createGuardrail,
  type Guardrail,
  type GuardrailDecision,
  type InspectInput,
} from "./safety/guardrail.js";
import { type RiskLevel } from "./safety/sql-validator.js";
import {
  createSchemaIntrospector,
  type DatabaseInfo,
  type SchemaIntrospector,
  type TableInfo,
  type TableSchema,
} from "./schema/introspector.js";
import { createMySqlSchemaAdapter } from "./schema/adapters/mysql.js";
import {
  buildFlashbackSql,
  flashbackReadonlyOptions,
  type FlashbackInput,
} from "./taurus/flashback.js";
import {
  createPlaceholderDiagnosticResult,
  type DbHotspotItem,
  type DbHotspotResult,
  type DiagnoseDbHotspotInput,
  type DiagnoseServiceLatencyInput,
  type FindTopSlowSqlInput,
  type FindTopSlowSqlResult,
  type DiagnoseConnectionSpikeInput,
  type DiagnoseLockContentionInput,
  type DiagnoseReplicationLagInput,
  type DiagnoseSlowQueryInput,
  type DiagnoseStoragePressureInput,
  type DiagnosticBaseInput,
  type DiagnosticRootCauseCandidate,
  type DiagnosticResult,
  type DiagnosticNextToolInput,
  type DiagnosticSeverity,
  type ServiceLatencyCandidate,
  type ServiceLatencyResult,
  type ServiceLatencySuspectedCategory,
} from "./diagnostics/types.js";
import {
  buildResolveSlowSqlInput,
  createSlowSqlSource,
  type ExternalSlowSqlSample,
  type SlowSqlSource,
} from "./diagnostics/slow-sql-source.js";
import {
  createMetricsSource,
  type MetricAlias,
  type MetricSummary,
  type MetricsSource,
} from "./diagnostics/metrics-source.js";
import { normalizeSql, sqlHash } from "./utils/hash.js";

export interface DataSourceInfo {
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database?: string;
  hasMutationUser: boolean;
  poolSize?: number;
  isDefault: boolean;
}

export type IssueConfirmationInput = {
  context: SessionContext;
  riskLevel: RiskLevel;
  sql?: string;
  normalizedSql?: string;
  sqlHash?: string;
  ttlSeconds?: number;
};

export type ConfirmationOutcome =
  | { status: "confirmed" }
  | {
      status: "token_issued";
      token: string;
      issuedAt: number;
      expiresAt: number;
    };

export interface EnhancedExplainResult {
  standardPlan: ExplainResult;
  treePlan?: string;
  taurusHints: {
    ndpPushdown: {
      condition: boolean;
      columns: boolean;
      aggregate: boolean;
      blockedReason?: string;
    };
    parallelQuery: {
      wouldEnable: boolean;
      estimatedDegree?: number;
      blockedReason?: string;
    };
    offsetPushdown: boolean;
  };
  optimizationSuggestions: string[];
}

export interface ShowProcesslistInput {
  user?: string;
  host?: string;
  sessionDatabase?: string;
  command?: string;
  minTimeSeconds?: number;
  maxRows?: number;
  includeIdle?: boolean;
  includeSystem?: boolean;
  includeInfo?: boolean;
  infoMaxChars?: number;
}

export interface ShowLockWaitsInput {
  table?: string;
  blockerSessionId?: string;
  maxRows?: number;
  includeSql?: boolean;
  sqlMaxChars?: number;
}

type ProcesslistRow = {
  sessionId?: string;
  user?: string;
  host?: string;
  databaseName?: string;
  command?: string;
  timeSeconds?: number;
  state?: string;
  infoPreview?: string;
};

type LockWaitRow = {
  waitingSessionId?: string;
  waitingUser?: string;
  waitingState?: string;
  waitingTrxState?: string;
  waitAgeSeconds?: number;
  blockingSessionId?: string;
  blockingUser?: string;
  blockingState?: string;
  blockingTrxState?: string;
  blockingTrxAgeSeconds?: number;
  lockedSchema?: string;
  lockedTable?: string;
  lockedIndex?: string;
  waitingLockType?: string;
  waitingLockMode?: string;
  blockingLockType?: string;
  blockingLockMode?: string;
  waitingQuery?: string;
  blockingQuery?: string;
};

type MetadataLockRow = {
  waitingSessionId?: string;
  waitingUser?: string;
  waitingState?: string;
  blockingSessionId?: string;
  blockingUser?: string;
  blockingState?: string;
  objectType?: string;
  objectSchema?: string;
  objectName?: string;
  waitingLockType?: string;
  waitingLockDuration?: string;
  blockingLockType?: string;
  blockingLockDuration?: string;
};

type DeadlockSummary = {
  detectedAt?: string;
  summary: string;
  waitingTables: string[];
  blockingTables: string[];
  transactionIds: string[];
};

type StatementDigestRow = {
  schemaName?: string;
  digest?: string;
  digestText?: string;
  querySampleText?: string;
  execCount?: number;
  avgLatencyMs?: number;
  totalLatencyMs?: number;
  maxLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  avgSortRows?: number;
  avgTmpTables?: number;
  avgTmpDiskTables?: number;
  selectScanCount?: number;
  noIndexUsedCount?: number;
};

type StatementWaitEventRow = {
  eventName?: string;
  sampleCount?: number;
  statementCount?: number;
  totalWaitMs?: number;
  avgWaitMs?: number;
};

type PlanTableStats = {
  table: string;
  rowCountEstimate?: number;
  indexCount: number;
  primaryKey?: string[];
};

type TableStorageRow = {
  schemaName?: string;
  tableName?: string;
  engine?: string;
  rowCountEstimate?: number;
  totalMb?: number;
  dataMb?: number;
  indexMb?: number;
  dataFreeMb?: number;
};

type ReplicationStatusRow = {
  channelName?: string;
  replicaIoRunning?: string;
  replicaSqlRunning?: string;
  secondsBehindSource?: number;
  retrievedGtidSet?: string;
  executedGtidSet?: string;
  lastIoError?: string;
  lastSqlError?: string;
};

function withDatasourceSummary(prefix: string, datasource: string): string {
  return `${prefix} on datasource ${datasource}.`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function escapeLikePrefix(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function parseProcesslistRows(result: QueryResult): ProcesslistRow[] {
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

function parseOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseInt(value, 10)
      : undefined;
}

function parseLockWaitRows(result: QueryResult): LockWaitRow[] {
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

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseFloat(value)
      : undefined;
}

function parseMetadataLockRows(result: QueryResult): MetadataLockRow[] {
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

function parseDeadlockSummary(result: QueryResult): DeadlockSummary | undefined {
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

function parseStatementDigestRows(result: QueryResult): StatementDigestRow[] {
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

function topSlowSqlOrderBy(sortBy: FindTopSlowSqlInput["sortBy"]): string {
  switch (sortBy) {
    case "avg_latency":
      return "AVG_TIMER_WAIT DESC, SUM_TIMER_WAIT DESC, COUNT_STAR DESC";
    case "exec_count":
      return "COUNT_STAR DESC, SUM_TIMER_WAIT DESC, AVG_TIMER_WAIT DESC";
    case "lock_time":
      return "SUM_LOCK_TIME DESC, SUM_TIMER_WAIT DESC, COUNT_STAR DESC";
    case "total_latency":
    default:
      return "SUM_TIMER_WAIT DESC, AVG_TIMER_WAIT DESC, COUNT_STAR DESC";
  }
}

function normalizeSqlForDigestMatch(sql: string): string {
  const normalized = normalizeSql(sql).replace(/`([^`]+)`/g, "$1");
  let result = "";
  let index = 0;
  let quoteState: "'" | '"' | "none" = "none";

  while (index < normalized.length) {
    const char = normalized[index];

    if (quoteState === "none") {
      if (char === "'" || char === '"') {
        quoteState = char;
        result += "?";
        index += 1;
        continue;
      }
      if (
        /[0-9]/.test(char) &&
        (index === 0 || !/[A-Za-z0-9_$]/.test(normalized[index - 1] ?? ""))
      ) {
        result += "?";
        index += 1;
        while (
          index < normalized.length &&
          /[A-Za-z0-9_.+-]/.test(normalized[index])
        ) {
          index += 1;
        }
        continue;
      }
      result += char;
      index += 1;
      continue;
    }

    if (char === quoteState) {
      if (normalized[index + 1] === quoteState) {
        index += 2;
        continue;
      }
      quoteState = "none";
    }
    index += 1;
  }

  return result
    .replace(/\bNULL\b/gi, "?")
    .replace(/\b(TRUE|FALSE)\b/gi, "?")
    .replace(/\s*([=<>!+\-*/%,()])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function digestMatchScore(sql: string, candidate: StatementDigestRow): number {
  const normalizedSql = normalizeSql(sql);
  const normalizedSqlHash = sqlHash(normalizedSql);
  const sqlShape = normalizeSqlForDigestMatch(sql);

  if (
    candidate.querySampleText &&
    sqlHash(normalizeSql(candidate.querySampleText)) === normalizedSqlHash
  ) {
    return 100;
  }

  if (
    candidate.querySampleText &&
    normalizeSqlForDigestMatch(candidate.querySampleText) === sqlShape
  ) {
    return 80;
  }

  if (
    candidate.digestText &&
    normalizeSqlForDigestMatch(candidate.digestText) === sqlShape
  ) {
    return 70;
  }

  return 0;
}

function parseStatementWaitEventRows(
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

function parseTableStorageRows(result: QueryResult): TableStorageRow[] {
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

function parseReplicationStatusRows(
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

function extractPlanTableNames(plan: ExplainResult["plan"]): string[] {
  const names = plan
    .map((row) => {
      if (!row || typeof row !== "object") {
        return undefined;
      }
      const candidate =
        (row.table as unknown) ??
        (row.table_name as unknown) ??
        (row.TABLE as unknown);
      return typeof candidate === "string" ? candidate.trim() : undefined;
    })
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.length > 0 &&
        value.toUpperCase() !== "NULL" &&
        !value.startsWith("<"),
    );
  return [...new Set(names)];
}

function extractSqlTableNameHints(sql: string): string[] {
  const hints = new Set<string>();
  const pattern =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z0-9_$]+)`?(?:\s*\.\s*`?([A-Za-z0-9_$]+)`?)?/gi;
  let match = pattern.exec(sql);
  while (match) {
    hints.add(match[2] ?? match[1]);
    match = pattern.exec(sql);
  }
  return [...hints];
}

function countBy<T>(
  rows: T[],
  pick: (row: T) => string | undefined,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    );
}

function pickMetric(
  metrics: MetricSummary[],
  alias: MetricAlias,
): MetricSummary | undefined {
  return metrics.find((metric) => metric.alias === alias);
}

function metricSummaryText(metric: MetricSummary): string {
  const parts = [
    `metric=${metric.metricName}`,
    `points=${metric.points.length}`,
    metric.latest !== undefined
      ? `latest=${roundMetric(metric.latest)}`
      : undefined,
    metric.max !== undefined ? `max=${roundMetric(metric.max)}` : undefined,
    metric.avg !== undefined ? `avg=${roundMetric(metric.avg)}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(", ");
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function queryMetricsSafely(
  source: MetricsSource | undefined,
  aliases: MetricAlias[],
  input: DiagnosticBaseInput,
  ctx: SessionContext,
): Promise<MetricSummary[]> {
  if (!source) {
    return [];
  }
  try {
    return await source.query({ aliases, timeRange: input.timeRange }, ctx);
  } catch {
    return [];
  }
}

function metricsSourceLimitation(source: MetricsSource | undefined): string[] {
  return source
    ? []
    : ["No CES or control-plane metrics source is configured yet."];
}

function confidenceWeight(
  value: ServiceLatencyCandidate["confidence"],
): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function rootCauseBasePriority(code: string): number {
  switch (code) {
    case "slow_query_full_table_scan":
      return 90;
    case "slow_query_poor_index_usage":
      return 60;
    case "slow_query_runtime_scan_pressure":
      return 70;
    case "slow_query_tmp_disk_spill":
      return 65;
    case "slow_query_wait_event_lock_contention":
      return 60;
    case "slow_query_lock_wait_pressure":
      return 55;
    case "slow_query_filesort":
      return 50;
    case "slow_query_temp_structure":
      return 45;
    case "slow_query_wait_event_io_pressure":
      return 40;
    case "slow_query_wait_event_sync_contention":
      return 35;
    case "slow_query_taurus_feature_gap":
      return 20;
    case "slow_query_plan_collected":
      return 10;
    default:
      return 0;
  }
}

function rootCauseConfidenceWeight(
  value: DiagnosticRootCauseCandidate["confidence"],
): number {
  switch (value) {
    case "high":
      return 30;
    case "medium":
      return 15;
    default:
      return 0;
  }
}

function rootCauseRankScore(candidate: DiagnosticRootCauseCandidate): number {
  return (
    rootCauseBasePriority(candidate.code) +
    rootCauseConfidenceWeight(candidate.confidence)
  );
}

function sortRootCauseCandidates(
  candidates: DiagnosticRootCauseCandidate[],
): DiagnosticRootCauseCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      rootCauseRankScore(right) - rootCauseRankScore(left) ||
      rootCauseBasePriority(right.code) - rootCauseBasePriority(left.code) ||
      rootCauseConfidenceWeight(right.confidence) -
        rootCauseConfidenceWeight(left.confidence) ||
      left.code.localeCompare(right.code),
  );
}

function severityFromSlowQueryEvidence(
  riskSummary: ExplainResult["riskSummary"],
  candidates: DiagnosticRootCauseCandidate[],
): DiagnosticSeverity {
  if (
    riskSummary.fullTableScanLikely ||
    riskSummary.usesFilesort ||
    riskSummary.usesTempStructure
  ) {
    return (riskSummary.estimatedRows ?? 0) >= 100_000 ? "high" : "warning";
  }
  if (candidates.some((candidate) => candidate.confidence === "high")) {
    return "warning";
  }
  if (candidates.some((candidate) => candidate.confidence === "medium")) {
    return "warning";
  }
  return "info";
}

function serviceCategoryPriority(
  value: ServiceLatencySuspectedCategory,
): number {
  switch (value) {
    case "lock_contention":
      return 5;
    case "connection_spike":
      return 4;
    case "slow_sql":
      return 3;
    case "resource_pressure":
      return 2;
    case "mixed":
    default:
      return 1;
  }
}

function hotspotTypePriority(value: DbHotspotItem["type"]): number {
  switch (value) {
    case "session":
      return 3;
    case "table":
      return 2;
    case "sql":
    default:
      return 1;
  }
}

function buildSlowQueryNextToolInput(
  source: {
    sqlHash?: string;
    digestText?: string;
    sampleSql?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput | undefined {
  const slowQueryInput: Record<string, unknown> = {};
  if (input.datasource) {
    slowQueryInput.datasource = input.datasource;
  }
  if (input.database) {
    slowQueryInput.database = input.database;
  }
  if (input.timeRange) {
    slowQueryInput.time_range = input.timeRange;
  }
  if (input.evidenceLevel) {
    slowQueryInput.evidence_level = input.evidenceLevel;
  }
  if (input.includeRawEvidence !== undefined) {
    slowQueryInput.include_raw_evidence = input.includeRawEvidence;
  }
  if (input.maxCandidates !== undefined) {
    slowQueryInput.max_candidates = input.maxCandidates;
  }
  if (source.sampleSql) {
    slowQueryInput.sql = source.sampleSql;
  } else if (source.digestText) {
    slowQueryInput.digest_text = source.digestText;
  } else if (source.sqlHash) {
    slowQueryInput.sql_hash = source.sqlHash;
  } else {
    return undefined;
  }

  return {
    tool: "diagnose_slow_query",
    input: slowQueryInput,
    rationale,
  };
}

function buildBaseNextToolInput(
  input: DiagnosticBaseInput,
): Record<string, unknown> {
  const nextInput: Record<string, unknown> = {};
  if (input.datasource) {
    nextInput.datasource = input.datasource;
  }
  if (input.database) {
    nextInput.database = input.database;
  }
  if (input.timeRange) {
    nextInput.time_range = input.timeRange;
  }
  if (input.evidenceLevel) {
    nextInput.evidence_level = input.evidenceLevel;
  }
  if (input.includeRawEvidence !== undefined) {
    nextInput.include_raw_evidence = input.includeRawEvidence;
  }
  if (input.maxCandidates !== undefined) {
    nextInput.max_candidates = input.maxCandidates;
  }
  return nextInput;
}

function buildDbHotspotNextToolInput(
  source: {
    scope?: "sql" | "table" | "session";
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.scope) {
    nextInput.scope = source.scope;
  }
  return {
    tool: "diagnose_db_hotspot",
    input: nextInput,
    rationale,
  };
}

function buildFindTopSlowSqlNextToolInput(
  source: {
    sortBy?: "avg_latency" | "total_latency" | "exec_count" | "lock_time";
    topN?: number;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.sortBy) {
    nextInput.sort_by = source.sortBy;
  }
  if (source.topN !== undefined) {
    nextInput.top_n = source.topN;
  }
  return {
    tool: "find_top_slow_sql",
    input: nextInput,
    rationale,
  };
}

function buildLockContentionNextToolInput(
  source: {
    table?: string;
    blockerSessionId?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.table) {
    nextInput.table = source.table;
  }
  if (source.blockerSessionId) {
    nextInput.blocker_session_id = source.blockerSessionId;
  }
  return {
    tool: "diagnose_lock_contention",
    input: nextInput,
    rationale,
  };
}

function buildConnectionSpikeNextToolInput(
  source: {
    user?: string;
    clientHost?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.user) {
    nextInput.user = source.user;
  }
  if (source.clientHost) {
    nextInput.client_host = source.clientHost;
  }
  nextInput.compare_baseline = false;
  return {
    tool: "diagnose_connection_spike",
    input: nextInput,
    rationale,
  };
}

function buildShowProcesslistNextToolInput(
  source: {
    user?: string;
    host?: string;
    command?: string;
    includeIdle?: boolean;
    includeInfo?: boolean;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.user) {
    nextInput.user = source.user;
  }
  if (source.host) {
    nextInput.host = source.host;
  }
  if (source.command) {
    nextInput.command = source.command;
  }
  nextInput.include_idle = source.includeIdle ?? true;
  nextInput.include_info = source.includeInfo ?? true;
  nextInput.max_rows = 20;
  return {
    tool: "show_processlist",
    input: nextInput,
    rationale,
  };
}

function dedupeNextToolInputs(
  inputs: DiagnosticNextToolInput[],
): DiagnosticNextToolInput[] {
  return inputs.filter((item, index, allItems) => {
    const key = `${item.tool}:${JSON.stringify(item.input)}`;
    return (
      allItems.findIndex((candidate) => {
        const candidateKey = `${candidate.tool}:${JSON.stringify(candidate.input)}`;
        return candidateKey === key;
      }) === index
    );
  });
}

function evidenceRowLimit(
  level: DiagnoseConnectionSpikeInput["evidenceLevel"],
): number {
  switch (level) {
    case "full":
      return 100;
    case "standard":
      return 50;
    default:
      return 20;
  }
}

function lockEvidenceRowLimit(
  level: DiagnoseLockContentionInput["evidenceLevel"],
): number {
  switch (level) {
    case "full":
      return 100;
    case "standard":
      return 50;
    default:
      return 20;
  }
}

export interface TaurusDBEngineDeps {
  config: Config;
  profileLoader: ProfileLoader;
  secretResolver: SecretResolver;
  datasourceResolver: DatasourceResolver;
  connectionPool: ConnectionPool;
  schemaIntrospector: SchemaIntrospector;
  guardrail: Guardrail;
  executor: SqlExecutor;
  confirmationStore: ConfirmationStore;
  capabilityProbe: CapabilityProbe;
  slowSqlSource?: SlowSqlSource;
  metricsSource?: MetricsSource;
}

export interface TaurusDBEngineCreateOptions {
  config?: Config;
  profileLoader?: ProfileLoader;
  secretResolver?: SecretResolver;
  datasourceResolver?: DatasourceResolver;
  connectionPool?: ConnectionPool;
  schemaIntrospector?: SchemaIntrospector;
  guardrail?: Guardrail;
  executor?: SqlExecutor;
  confirmationStore?: ConfirmationStore;
  capabilityProbe?: CapabilityProbe;
  slowSqlSource?: SlowSqlSource;
  metricsSource?: MetricsSource;
}

function toDataSourceInfo(
  profile: DataSourceProfile,
  defaultDatasource: string | undefined,
): DataSourceInfo {
  return {
    name: profile.name,
    engine: profile.engine,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    hasMutationUser: profile.mutationUser !== undefined,
    poolSize: profile.poolSize,
    isDefault: profile.name === defaultDatasource,
  };
}

function resolveConfirmationSql(input: IssueConfirmationInput): {
  normalized: string;
  hash: string;
} {
  const normalized =
    input.normalizedSql ?? (input.sql ? normalizeSql(input.sql) : undefined);
  const hash = input.sqlHash ?? (normalized ? sqlHash(normalized) : undefined);

  if (!normalized || !hash) {
    throw new Error(
      "Issue confirmation requires sql, normalizedSql, or sqlHash context.",
    );
  }

  return { normalized, hash };
}

function explainExtras(plan: ExplainResult["plan"]): string[] {
  return plan
    .map((row) => {
      if (!row || typeof row !== "object") {
        return undefined;
      }
      const extra = (row.Extra ?? row.extra) as unknown;
      return typeof extra === "string" ? extra : undefined;
    })
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
}

function hasSqlPattern(sql: string, pattern: RegExp): boolean {
  return pattern.test(sql);
}

function buildEnhancedExplainSuggestions(
  sql: string,
  features: FeatureMatrix,
  explainResult: ExplainResult,
): string[] {
  const suggestions: string[] = [...explainResult.recommendations];

  if (!features.parallel_query.available) {
    suggestions.push("parallel_query is unavailable on this instance.");
  } else if (features.parallel_query.enabled === false) {
    suggestions.push(
      "parallel_query is available but disabled. Consider SET GLOBAL force_parallel_execute=ON.",
    );
  }

  if (!features.flashback_query.available) {
    suggestions.push(
      "flashback_query is unavailable; high-risk mutations have weaker recovery options.",
    );
  }

  if (
    features.offset_pushdown.available &&
    features.offset_pushdown.enabled !== false
  ) {
    if (hasSqlPattern(sql, /\boffset\s+\d+/i)) {
      suggestions.push(
        "OFFSET detected. TaurusDB offset_pushdown may help reduce coordinator overhead.",
      );
    }
  }

  if (
    explainResult.riskSummary.fullTableScanLikely &&
    features.ndp_pushdown.available
  ) {
    suggestions.push(
      "Full table scan is likely. Review whether NDP pushdown can reduce scanned rows.",
    );
  }

  return [...new Set(suggestions)];
}

export class TaurusDBEngine {
  readonly config: Config;
  readonly profileLoader: ProfileLoader;
  readonly secretResolver: SecretResolver;
  readonly datasourceResolver: DatasourceResolver;
  readonly connectionPool: ConnectionPool;
  readonly schemaIntrospector: SchemaIntrospector;
  readonly guardrail: Guardrail;
  readonly executor: SqlExecutor;
  readonly confirmationStore: ConfirmationStore;
  readonly capabilityProbe: CapabilityProbe;
  readonly slowSqlSource?: SlowSqlSource;
  readonly metricsSource?: MetricsSource;

  constructor(deps: TaurusDBEngineDeps) {
    this.config = deps.config;
    this.profileLoader = deps.profileLoader;
    this.secretResolver = deps.secretResolver;
    this.datasourceResolver = deps.datasourceResolver;
    this.connectionPool = deps.connectionPool;
    this.schemaIntrospector = deps.schemaIntrospector;
    this.guardrail = deps.guardrail;
    this.executor = deps.executor;
    this.confirmationStore = deps.confirmationStore;
    this.capabilityProbe = deps.capabilityProbe;
    this.slowSqlSource = deps.slowSqlSource;
    this.metricsSource = deps.metricsSource;
  }

  static async create(
    options: TaurusDBEngineCreateOptions = {},
  ): Promise<TaurusDBEngine> {
    const config = options.config ?? getConfig();
    const profileLoader =
      options.profileLoader ?? createSqlProfileLoader({ config });
    const secretResolver = options.secretResolver ?? createSecretResolver();
    const datasourceResolver =
      options.datasourceResolver ??
      createDatasourceResolver({
        config,
        profileLoader,
      });
    const connectionPool =
      options.connectionPool ??
      createConnectionPoolManager({
        config,
        profileLoader,
        secretResolver,
        adapters: {
          mysql: createMySqlDriverAdapter(),
        },
      });
    const schemaIntrospector =
      options.schemaIntrospector ??
      createSchemaIntrospector({
        adapters: {
          mysql: createMySqlSchemaAdapter({ connectionPool }),
        },
      });
    const executor =
      options.executor ??
      createSqlExecutor({
        connectionPool,
      });
    const guardrail = options.guardrail ?? createGuardrail();
    const confirmationStore =
      options.confirmationStore ?? createConfirmationStore();
    const capabilityProbe =
      options.capabilityProbe ??
      createCapabilityProbe({
        connectionPool,
      });
    const slowSqlSource = options.slowSqlSource ?? createSlowSqlSource(config);
    const metricsSource = options.metricsSource ?? createMetricsSource(config);

    return new TaurusDBEngine({
      config,
      profileLoader,
      secretResolver,
      datasourceResolver,
      connectionPool,
      schemaIntrospector,
      guardrail,
      executor,
      confirmationStore,
      capabilityProbe,
      slowSqlSource,
      metricsSource,
    });
  }

  async listDataSources(): Promise<DataSourceInfo[]> {
    const [profiles, defaultDatasource] = await Promise.all([
      this.profileLoader.load(),
      this.profileLoader.getDefault(),
    ]);

    return [...profiles.values()]
      .map((profile) => toDataSourceInfo(profile, defaultDatasource))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getDefaultDataSource(): Promise<string | undefined> {
    return this.profileLoader.getDefault();
  }

  async resolveContext(
    input: DatasourceResolveInput,
    taskId: string,
  ): Promise<SessionContext> {
    return this.datasourceResolver.resolve(input, taskId);
  }

  async listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]> {
    return this.schemaIntrospector.listDatabases(ctx);
  }

  async listTables(
    ctx: SessionContext,
    database: string,
  ): Promise<TableInfo[]> {
    return this.schemaIntrospector.listTables(ctx, database);
  }

  async describeTable(
    ctx: SessionContext,
    database: string,
    table: string,
  ): Promise<TableSchema> {
    return this.schemaIntrospector.describeTable(ctx, database, table);
  }

  async inspectSql(input: InspectInput): Promise<GuardrailDecision> {
    return this.guardrail.inspect(input);
  }

  async probeCapabilities(ctx: SessionContext): Promise<CapabilitySnapshot> {
    return this.capabilityProbe.probe(ctx);
  }

  async getKernelInfo(ctx: SessionContext): Promise<KernelInfo> {
    return this.capabilityProbe.getKernelInfo(ctx);
  }

  async listFeatures(ctx: SessionContext): Promise<FeatureMatrix> {
    return this.capabilityProbe.listFeatures(ctx);
  }

  async showProcesslist(
    input: ShowProcesslistInput,
    ctx: SessionContext,
  ): Promise<QueryResult> {
    const maxRows = clampInteger(input.maxRows, 20, 1, 100);
    const minTimeSeconds = clampInteger(input.minTimeSeconds, 0, 0, 86_400);
    const includeIdle = input.includeIdle === true;
    const includeSystem = input.includeSystem === true;
    const includeInfo = input.includeInfo === true;
    const infoMaxChars = clampInteger(input.infoMaxChars, 256, 32, 2048);

    const selectedColumns = [
      "ID AS session_id",
      "USER AS user",
      "HOST AS host",
      "DB AS database_name",
      "COMMAND AS command",
      "TIME AS time_seconds",
      "STATE AS state",
    ];
    if (includeInfo) {
      selectedColumns.push("INFO AS info_preview");
    }

    const whereClauses: string[] = [];
    if (!includeIdle) {
      whereClauses.push("COMMAND <> 'Sleep'");
    }
    if (!includeSystem) {
      whereClauses.push("USER <> 'system user'");
    }
    if (input.user) {
      whereClauses.push(`USER = ${quoteLiteral(input.user)}`);
    }
    if (input.host) {
      whereClauses.push(
        `HOST LIKE ${quoteLiteral(`${escapeLikePrefix(input.host)}%`)} ESCAPE '\\'`,
      );
    }
    if (input.sessionDatabase) {
      whereClauses.push(`DB = ${quoteLiteral(input.sessionDatabase)}`);
    }
    if (input.command) {
      whereClauses.push(`COMMAND = ${quoteLiteral(input.command)}`);
    }
    if (minTimeSeconds > 0) {
      whereClauses.push(`TIME >= ${minTimeSeconds}`);
    }

    const sql = `
      SELECT ${selectedColumns.join(", ")}
      FROM information_schema.PROCESSLIST
      ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY TIME DESC, ID DESC
      LIMIT ${maxRows}
    `.trim();

    return this.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: selectedColumns.length,
      maxFieldChars: includeInfo ? infoMaxChars : 256,
      timeoutMs: ctx.limits.timeoutMs,
    });
  }

  async showLockWaits(
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

    return this.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: selectedColumns.length,
      maxFieldChars: includeSql ? sqlMaxChars : 256,
      timeoutMs: ctx.limits.timeoutMs,
    });
  }

  async findMetadataLockWaits(
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
      const result = await this.executor.executeReadonly(sql, ctx, {
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

  async findLatestDeadlock(
    ctx: SessionContext,
  ): Promise<DeadlockSummary | undefined> {
    try {
      const result = await this.executor.executeReadonly(
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

  async findStatementDigestSample(
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

    const result = await this.executor.executeReadonly(sql, ctx, {
      maxRows: 1,
      maxColumns: 15,
      maxFieldChars: 2048,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result)[0];
  }

  async findStatementDigestSampleForSql(
    sql: string,
    ctx: SessionContext,
  ): Promise<StatementDigestRow | undefined> {
    const candidates = await this.findTopStatementDigests(
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

    const hintCandidates = await this.findStatementDigestCandidatesForSqlHints(
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

  async findStatementDigestCandidatesForSqlHints(
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

    const result = await this.executor.executeReadonly(sql, ctx, {
      maxRows: 50,
      maxColumns: 15,
      maxFieldChars: 4096,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result);
  }

  async findTopStatementDigests(
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

    const result = await this.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: 15,
      maxFieldChars: 4096,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result);
  }

  async findStorageStatementDigests(
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

    const result = await this.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: 15,
      maxFieldChars: 4096,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result);
  }

  async findStatementWaitEvents(
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
      const result = await this.executor.executeReadonly(sql, ctx, {
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

  async findTableStorageStats(
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

    const result = await this.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: 8,
      maxFieldChars: 512,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseTableStorageRows(result);
  }

  async diagnoseSlowQuery(
    input: DiagnoseSlowQueryInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const sqlMatchedDigestSample = input.sql
      ? await this.findStatementDigestSampleForSql(input.sql, ctx)
      : undefined;
    const externalSlowSqlSample =
      !input.sql && this.slowSqlSource
        ? await this.slowSqlSource.resolve(buildResolveSlowSqlInput(input), ctx)
        : undefined;
    const digestSample =
      sqlMatchedDigestSample ??
      (!input.sql && input.digestText
        ? await this.findStatementDigestSample(input.digestText, ctx)
        : undefined);
    const waitEventRows =
      input.digestText || digestSample?.digestText
        ? await this.findStatementWaitEvents(
            input.digestText ?? digestSample?.digestText ?? "",
            ctx,
          )
        : [];
    const effectiveSql =
      input.sql ?? externalSlowSqlSample?.sql ?? digestSample?.querySampleText;
    const derivedSqlHash = effectiveSql
      ? sqlHash(normalizeSql(effectiveSql))
      : undefined;
    const runtimeLockTimeMs =
      digestSample?.avgLockTimeMs ?? externalSlowSqlSample?.avgLockTimeMs;
    const runtimeRowsExamined =
      digestSample?.avgRowsExamined ?? externalSlowSqlSample?.avgRowsExamined;
    const suspiciousSql =
      effectiveSql || input.sqlHash || input.digestText
        ? [
            {
              sqlHash: input.sqlHash ?? derivedSqlHash,
              digestText: input.digestText ?? digestSample?.digestText,
              reason: input.sql
                ? digestSample?.digestText
                  ? "SQL text was provided, matched to performance_schema digest summaries, and analyzed with EXPLAIN plus runtime evidence."
                  : "SQL text was provided and analyzed with EXPLAIN evidence."
                : externalSlowSqlSample?.sql
                  ? "A SQL sample was resolved from the TaurusDB slow-log source and analyzed with EXPLAIN evidence."
                  : digestSample?.querySampleText
                    ? "A statement sample was resolved from performance_schema digest summaries and analyzed with EXPLAIN evidence."
                    : "Only an SQL identifier was provided, so live EXPLAIN evidence could not be collected yet.",
            },
          ]
        : undefined;

    if (!effectiveSql) {
      return {
        tool: "diagnose_slow_query",
        status: "inconclusive",
        severity: "info",
        summary: withDatasourceSummary(
          "Slow-query diagnosis needs SQL text for EXPLAIN-backed analysis",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "slow_query_missing_sql_text",
            title: "SQL text is required for explain-backed diagnosis",
            confidence: "low",
            rationale:
              "The current implementation can analyze a slow query only when the SQL text is available for live EXPLAIN correlation.",
          },
        ],
        keyFindings: [
          input.sqlHash
            ? `SQL hash ${input.sqlHash} was provided without the original SQL text.`
            : "No SQL text was provided.",
          externalSlowSqlSample
            ? "An external TaurusDB slow-log source was queried, but no usable SQL sample was returned."
            : undefined,
          input.digestText
            ? "Digest text was provided, but no matching statement sample was available in the configured sources."
            : "No digest text was provided.",
        ].filter((value): value is string => typeof value === "string"),
        suspiciousEntities: suspiciousSql ? { sqls: suspiciousSql } : undefined,
        evidence: [
          {
            source: "sql_identifier",
            title: "SQL identifier only",
            summary:
              "The diagnosis request contained an SQL identifier, but no live EXPLAIN was run because the SQL text could not be resolved.",
          },
        ],
        recommendedActions: [
          "Provide the full SQL text so the tool can run explain-based diagnosis.",
          "If TaurusDB slow-log API is configured, verify its project, instance, node, and token settings.",
          "If you are using digest_text, verify that performance_schema statement digest summaries are enabled and retaining QUERY_SAMPLE_TEXT.",
        ],
        limitations: [
          this.slowSqlSource
            ? "Identifier-only diagnosis currently depends on TaurusDB slow-log samples and performance_schema digest samples."
            : "No external slow-SQL source is connected yet.",
          this.slowSqlSource
            ? "The TaurusDB slow-log source currently resolves SQL samples but does not yet provide full Top SQL or all-query history coverage."
            : "Identifier-only diagnosis is limited to performance_schema digest samples in the current version.",
        ],
      };
    }

    const explain = await this.explainEnhanced(effectiveSql, ctx);
    const standardPlan = explain.standardPlan;
    const riskSummary = standardPlan.riskSummary;
    const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
    const planTables: Array<PlanTableStats | undefined> = ctx.database
      ? await Promise.all(
          extractPlanTableNames(standardPlan.plan)
            .slice(0, 3)
            .map(async (table) => {
              try {
                const schema = await this.describeTable(
                  ctx,
                  ctx.database!,
                  table,
                );
                return {
                  table: `${ctx.database}.${table}`,
                  rowCountEstimate: schema.rowCountEstimate,
                  indexCount: schema.indexes.length,
                  primaryKey: schema.primaryKey,
                } as PlanTableStats;
              } catch {
                return undefined;
              }
            }),
        )
      : [];
    const resolvedPlanTables = planTables.filter(
      (value): value is PlanTableStats => value !== undefined,
    );

    if (riskSummary.fullTableScanLikely) {
      rootCauseCandidates.push({
        code: "slow_query_full_table_scan",
        title: "Full table scan is the dominant slowdown signal",
        confidence:
          (riskSummary.estimatedRows ?? 0) >= 100_000 ? "high" : "medium",
        rationale: `EXPLAIN indicates a likely full table scan${riskSummary.estimatedRows !== undefined ? ` across about ${riskSummary.estimatedRows} rows` : ""}.`,
      });
    }
    if (riskSummary.usesFilesort) {
      rootCauseCandidates.push({
        code: "slow_query_filesort",
        title: "Filesort overhead is contributing to latency",
        confidence: "medium",
        rationale:
          "EXPLAIN shows filesort usage, which usually means extra sort work and potential disk spill under pressure.",
      });
    }
    if (riskSummary.usesTempStructure) {
      rootCauseCandidates.push({
        code: "slow_query_temp_structure",
        title: "Temporary structures are increasing execution cost",
        confidence: "medium",
        rationale:
          "EXPLAIN shows temporary structures, which often indicates expensive grouping, sorting, or join reshaping.",
      });
    }
    if (!riskSummary.indexHitLikely) {
      rootCauseCandidates.push({
        code: "slow_query_poor_index_usage",
        title: "Index usage looks weak or absent",
        confidence: riskSummary.fullTableScanLikely ? "high" : "medium",
        rationale:
          "The plan does not look index-friendly, which increases scanned rows and slows execution.",
      });
    }
    if (
      explain.taurusHints.parallelQuery.blockedReason ||
      explain.taurusHints.ndpPushdown.blockedReason
    ) {
      rootCauseCandidates.push({
        code: "slow_query_taurus_feature_gap",
        title: "TaurusDB acceleration features may not be fully available",
        confidence: "low",
        rationale: [
          explain.taurusHints.parallelQuery.blockedReason,
          explain.taurusHints.ndpPushdown.blockedReason,
        ]
          .filter((value): value is string => typeof value === "string")
          .join(" "),
      });
    }
    if ((digestSample?.avgTmpDiskTables ?? 0) > 0) {
      rootCauseCandidates.push({
        code: "slow_query_tmp_disk_spill",
        title: "Temporary tables are spilling to disk",
        confidence:
          (digestSample?.avgTmpDiskTables ?? 0) >= 1 ? "medium" : "low",
        rationale: `Digest summaries show about ${digestSample?.avgTmpDiskTables} temporary disk tables per execution, which suggests spill-heavy grouping or sorting.`,
      });
    }
    if ((runtimeLockTimeMs ?? 0) >= 10) {
      rootCauseCandidates.push({
        code: "slow_query_lock_wait_pressure",
        title: "Lock wait time is a material part of the statement latency",
        confidence: (runtimeLockTimeMs ?? 0) >= 100 ? "high" : "medium",
        rationale: `${digestSample?.avgLockTimeMs !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeLockTimeMs} ms of lock time per execution, which suggests blocking or lock-wait pressure on the statement path.`,
      });
    }
    const topWaitEvent = waitEventRows[0];
    if (topWaitEvent?.eventName?.startsWith("wait/lock/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_lock_contention",
        title: "Runtime wait events point to lock contention",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "high" : "medium",
        rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event${topWaitEvent.totalWaitMs !== undefined ? ` with about ${topWaitEvent.totalWaitMs} ms total wait time` : ""}.`,
      });
    } else if (topWaitEvent?.eventName?.startsWith("wait/io/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_io_pressure",
        title: "Runtime wait events point to I/O-bound execution",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
        rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which usually indicates file or handler I/O pressure.`,
      });
    } else if (topWaitEvent?.eventName?.startsWith("wait/synch/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_sync_contention",
        title: "Runtime wait events point to synchronization contention",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
        rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which suggests mutex or rwlock contention in the execution path.`,
      });
    }
    if (
      (digestSample?.noIndexUsedCount ?? 0) > 0 ||
      (digestSample?.selectScanCount ?? 0) > 0
    ) {
      rootCauseCandidates.push({
        code: "slow_query_runtime_scan_pressure",
        title: "Runtime summaries show scan-heavy executions",
        confidence:
          (digestSample?.noIndexUsedCount ?? 0) > 0 ? "medium" : "low",
        rationale: `Digest summaries recorded${(digestSample?.selectScanCount ?? 0) > 0 ? ` ${digestSample?.selectScanCount} scan-driven executions` : ""}${(digestSample?.selectScanCount ?? 0) > 0 && (digestSample?.noIndexUsedCount ?? 0) > 0 ? " and" : ""}${(digestSample?.noIndexUsedCount ?? 0) > 0 ? ` ${digestSample?.noIndexUsedCount} executions without index usage` : ""}.`,
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "slow_query_plan_collected",
        title:
          "Plan evidence was collected but no single dominant cause stood out",
        confidence: "low",
        rationale:
          "Live EXPLAIN evidence was collected, but the current heuristics did not isolate a single dominant full-scan, sort, or temporary-structure bottleneck.",
      });
    }

    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const sortedRootCauseCandidates =
      sortRootCauseCandidates(rootCauseCandidates);
    const severity = severityFromSlowQueryEvidence(
      riskSummary,
      sortedRootCauseCandidates,
    );

    const keyFindings = [
      riskSummary.estimatedRows !== undefined
        ? `EXPLAIN estimated about ${riskSummary.estimatedRows} rows for the analyzed statement.`
        : "EXPLAIN row estimate was not available.",
      riskSummary.fullTableScanLikely
        ? "The current plan is likely scanning the full table."
        : "The current plan does not strongly indicate a full table scan.",
      riskSummary.usesFilesort || riskSummary.usesTempStructure
        ? `The plan uses${riskSummary.usesFilesort ? " filesort" : ""}${riskSummary.usesFilesort && riskSummary.usesTempStructure ? " and" : ""}${riskSummary.usesTempStructure ? " temporary structures" : ""}.`
        : "The plan does not show filesort or temporary-structure overhead.",
    ];
    if (resolvedPlanTables.length > 0) {
      keyFindings.push(
        ...resolvedPlanTables.map(
          (tableStats) =>
            `${tableStats.table} has${tableStats.rowCountEstimate !== undefined ? ` row estimate ${tableStats.rowCountEstimate}` : " unknown row estimate"} and ${tableStats.indexCount} indexes.`,
        ),
      );
    }
    if (runtimeRowsExamined !== undefined) {
      keyFindings.push(
        `${digestSample?.avgRowsExamined !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeRowsExamined} rows examined per execution.`,
      );
    }
    if (runtimeLockTimeMs !== undefined) {
      keyFindings.push(
        `${digestSample?.avgLockTimeMs !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeLockTimeMs} ms of lock time per execution.`,
      );
    }
    if (digestSample) {
      if (
        (digestSample.avgTmpTables ?? 0) > 0 ||
        (digestSample.avgTmpDiskTables ?? 0) > 0
      ) {
        keyFindings.push(
          `Digest summaries show temporary table usage${digestSample.avgTmpTables !== undefined ? ` (avg_tmp_tables=${digestSample.avgTmpTables}` : ""}${digestSample.avgTmpDiskTables !== undefined ? `${digestSample.avgTmpTables !== undefined ? ", " : " ("}avg_tmp_disk_tables=${digestSample.avgTmpDiskTables}` : ""}${digestSample.avgTmpTables !== undefined || digestSample.avgTmpDiskTables !== undefined ? ")" : ""}.`,
        );
      }
    }
    if (externalSlowSqlSample && !digestSample) {
      keyFindings.push(
        `External TaurusDB slow-log samples resolved SQL text${externalSlowSqlSample.startTime ? ` from ${externalSlowSqlSample.startTime}` : ""}${externalSlowSqlSample.database ? ` for database ${externalSlowSqlSample.database}` : ""}.`,
      );
    }
    if (waitEventRows.length > 0) {
      keyFindings.push(
        `Statement history shows ${waitEventRows[0].eventName}${waitEventRows[0].totalWaitMs !== undefined ? ` as the top nested wait event (${waitEventRows[0].totalWaitMs} ms total)` : " as the top nested wait event"}.`,
      );
    }

    const recommendedActions = [
      ...standardPlan.recommendations,
      ...explain.optimizationSuggestions,
    ];
    if (riskSummary.fullTableScanLikely) {
      recommendedActions.push(
        "Review predicates and indexes so the query can avoid scanning the full table.",
      );
    }
    if (riskSummary.usesFilesort || riskSummary.usesTempStructure) {
      recommendedActions.push(
        "Review ORDER BY / GROUP BY / JOIN shape to reduce filesort and temporary-structure work.",
      );
    }
    if (
      explain.taurusHints.parallelQuery.blockedReason ||
      explain.taurusHints.ndpPushdown.blockedReason
    ) {
      recommendedActions.push(
        "Verify whether TaurusDB acceleration features are available and enabled for this workload.",
      );
    }
    if (
      !riskSummary.indexHitLikely &&
      resolvedPlanTables.some((tableStats) => tableStats.indexCount > 0)
    ) {
      recommendedActions.push(
        "The referenced tables already have indexes; compare the current predicates and sort columns against existing index definitions.",
      );
    }
    if ((digestSample?.avgTmpDiskTables ?? 0) > 0) {
      recommendedActions.push(
        "Check whether ORDER BY / GROUP BY can be supported by indexes to reduce temporary disk tables.",
      );
    }
    if ((digestSample?.noIndexUsedCount ?? 0) > 0) {
      recommendedActions.push(
        "Runtime digest summaries show no-index executions; compare the query shape with existing indexes and predicate selectivity.",
      );
    }
    if ((runtimeLockTimeMs ?? 0) >= 10) {
      recommendedActions.push(
        "Investigate blocker sessions or transaction scope because digest summaries show non-trivial lock time.",
      );
    }
    if (topWaitEvent?.eventName?.startsWith("wait/lock/")) {
      recommendedActions.push(
        "Correlate the dominant lock wait event with blocker sessions, transaction scope, and hot rows before changing the SQL shape.",
      );
    }
    if (topWaitEvent?.eventName?.startsWith("wait/io/")) {
      recommendedActions.push(
        "Check whether the dominant I/O wait aligns with table scans, filesort spill, or storage pressure on the accessed objects.",
      );
    }
    if (topWaitEvent?.eventName?.startsWith("wait/synch/")) {
      recommendedActions.push(
        "Inspect concurrency hotspots because synchronization waits suggest contention beyond the SQL text itself.",
      );
    }

    return {
      tool: "diagnose_slow_query",
      status: "ok",
      severity,
      summary: withDatasourceSummary(
        "Slow-query diagnosis collected live EXPLAIN evidence for the provided SQL",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: sortedRootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities: suspiciousSql ? { sqls: suspiciousSql } : undefined,
      evidence: [
        ...(externalSlowSqlSample
          ? [
              {
                source: externalSlowSqlSample.source,
                title: "External slow-log sample",
                summary: `A SQL sample was resolved from TaurusDB slow-log APIs${externalSlowSqlSample.avgLatencyMs !== undefined ? `; avg_latency_ms=${externalSlowSqlSample.avgLatencyMs}` : ""}${externalSlowSqlSample.avgLockTimeMs !== undefined ? `, avg_lock_time_ms=${externalSlowSqlSample.avgLockTimeMs}` : ""}${externalSlowSqlSample.avgRowsExamined !== undefined ? `, avg_rows_examined=${externalSlowSqlSample.avgRowsExamined}` : ""}${externalSlowSqlSample.execCount !== undefined ? `, exec_count=${externalSlowSqlSample.execCount}` : ""}${externalSlowSqlSample.database ? `, database=${externalSlowSqlSample.database}` : ""}.`,
                rawRef: externalSlowSqlSample.rawRef,
              },
            ]
          : []),
        ...(digestSample
          ? [
              {
                source: "statement_digest",
                title: "Digest summary sample",
                summary: `A query sample was resolved from performance_schema.events_statements_summary_by_digest${digestSample.execCount !== undefined ? `; exec_count=${digestSample.execCount}` : ""}${digestSample.avgLatencyMs !== undefined ? `, avg_latency_ms=${digestSample.avgLatencyMs}` : ""}${digestSample.maxLatencyMs !== undefined ? `, max_latency_ms=${digestSample.maxLatencyMs}` : ""}${digestSample.avgLockTimeMs !== undefined ? `, avg_lock_time_ms=${digestSample.avgLockTimeMs}` : ""}${digestSample.avgRowsExamined !== undefined ? `, avg_rows_examined=${digestSample.avgRowsExamined}` : ""}${digestSample.avgTmpDiskTables !== undefined ? `, avg_tmp_disk_tables=${digestSample.avgTmpDiskTables}` : ""}${digestSample.noIndexUsedCount !== undefined ? `, no_index_used_count=${digestSample.noIndexUsedCount}` : ""}.`,
              },
            ]
          : []),
        ...waitEventRows.map((row, index) => ({
          source: "statement_wait_history",
          title:
            index === 0
              ? "Dominant nested wait event"
              : `Nested wait event ${index + 1}`,
          summary: `${row.eventName ?? "unknown_event"}${row.totalWaitMs !== undefined ? ` total_wait_ms=${row.totalWaitMs}` : ""}${row.avgWaitMs !== undefined ? `, avg_wait_ms=${row.avgWaitMs}` : ""}${row.sampleCount !== undefined ? `, sample_count=${row.sampleCount}` : ""}${row.statementCount !== undefined ? `, statement_count=${row.statementCount}` : ""}.`,
        })),
        {
          source: "explain",
          title: "Live EXPLAIN plan",
          summary: `A live EXPLAIN plan was collected for the provided SQL${standardPlan.queryId ? ` (query id ${standardPlan.queryId})` : ""}.`,
        },
        {
          source: "explain",
          title: "Plan risk summary",
          summary: `full_scan=${riskSummary.fullTableScanLikely}, index_hit=${riskSummary.indexHitLikely}, filesort=${riskSummary.usesFilesort}, temp_structure=${riskSummary.usesTempStructure}${riskSummary.estimatedRows !== undefined ? `, estimated_rows=${riskSummary.estimatedRows}` : ""}.`,
        },
        ...resolvedPlanTables.map((tableStats) => ({
          source: "table_schema",
          title: `Referenced table ${tableStats.table}`,
          summary: `${tableStats.table} has${tableStats.rowCountEstimate !== undefined ? ` row_count_estimate=${tableStats.rowCountEstimate}` : " unknown row count"}${tableStats.primaryKey && tableStats.primaryKey.length > 0 ? `, primary_key=${tableStats.primaryKey.join(",")}` : ""}, index_count=${tableStats.indexCount}.`,
        })),
      ],
      recommendedActions: [...new Set(recommendedActions)],
      limitations: [
        this.slowSqlSource
          ? "Identifier-only diagnosis can use TaurusDB slow-log samples, but still depends on available retention and query_sample coverage."
          : "No external slow-SQL source is connected yet, so identifier-only diagnosis currently depends on performance_schema digest samples.",
        "Runtime wait-event correlation currently depends on performance_schema statement and wait history being enabled and retaining matching samples.",
      ],
    };
  }

  async diagnoseServiceLatency(
    input: DiagnoseServiceLatencyInput,
    ctx: SessionContext,
  ): Promise<ServiceLatencyResult> {
    const maxCandidates = clampInteger(input.maxCandidates, 5, 1, 10);
    const [topSlowSql, lockContention, connectionSpike, metrics] =
      await Promise.all([
        this.findTopSlowSql(
          {
            ...input,
            topN: Math.min(maxCandidates, 5),
            sortBy:
              input.symptom === "latency" || input.symptom === "timeout"
                ? "avg_latency"
                : "total_latency",
          },
          ctx,
        ),
        input.symptom === "connection_growth"
          ? Promise.resolve(undefined)
          : this.diagnoseLockContention(
              {
                ...input,
                maxCandidates: Math.min(maxCandidates, 3),
              },
              ctx,
            ),
        this.diagnoseConnectionSpike(
          {
            ...input,
            user: input.user,
            clientHost: input.clientHost,
            compareBaseline: false,
            maxCandidates: Math.min(maxCandidates, 3),
          },
          ctx,
        ),
        queryMetricsSafely(
          this.metricsSource,
          [
            "cpu_util",
            "mem_util",
            "connection_usage",
            "qps",
            "slow_queries",
            "storage_write_delay",
            "storage_read_delay",
            "replication_delay",
          ],
          input,
          ctx,
        ),
      ]);
    const cpuMetric = pickMetric(metrics, "cpu_util");
    const memMetric = pickMetric(metrics, "mem_util");
    const connectionUsageMetric = pickMetric(metrics, "connection_usage");
    const slowQueriesMetric = pickMetric(metrics, "slow_queries");
    const writeDelayMetric = pickMetric(metrics, "storage_write_delay");
    const readDelayMetric = pickMetric(metrics, "storage_read_delay");
    const replicationDelayMetric = pickMetric(metrics, "replication_delay");

    const topCandidates: ServiceLatencyCandidate[] = [];
    const evidence: ServiceLatencyResult["evidence"] = [];
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];
    const limitations = new Set<string>();
    const categoryScores = new Map<ServiceLatencySuspectedCategory, number>();

    const scoreCategory = (
      category: ServiceLatencySuspectedCategory,
      score: number,
    ) => {
      categoryScores.set(
        category,
        Math.max(categoryScores.get(category) ?? 0, score),
      );
    };

    if (topSlowSql.status === "ok" && topSlowSql.topSqls.length > 0) {
      const leadSql = topSlowSql.topSqls[0];
      const sqlConfidence: ServiceLatencyCandidate["confidence"] =
        (leadSql.totalLatencyMs ?? 0) >= 1000 ||
        (leadSql.avgLatencyMs ?? 0) >= 100
          ? "high"
          : (leadSql.totalLatencyMs ?? 0) > 0 || (leadSql.avgLatencyMs ?? 0) > 0
            ? "medium"
            : "low";

      topCandidates.push({
        type: "sql",
        title: leadSql.digestText
          ? `Top ranked SQL digest: ${leadSql.digestText}`
          : "Top ranked SQL digest",
        confidence: sqlConfidence,
        sqlHash: leadSql.sqlHash,
        digestText: leadSql.digestText,
        sampleSql: leadSql.sampleSql,
        rationale: `Ranked near the top of statement digest summaries${leadSql.avgLatencyMs !== undefined ? `; avg_latency_ms=${leadSql.avgLatencyMs}` : ""}${leadSql.totalLatencyMs !== undefined ? `, total_latency_ms=${leadSql.totalLatencyMs}` : ""}${leadSql.execCount !== undefined ? `, exec_count=${leadSql.execCount}` : ""}${leadSql.avgRowsExamined !== undefined ? `, avg_rows_examined=${leadSql.avgRowsExamined}` : ""}.`,
      });
      const slowQueryInput = buildSlowQueryNextToolInput(
        leadSql,
        input,
        "Analyze the top-ranked SQL candidate from the service-latency symptom route.",
      );
      if (slowQueryInput) {
        nextToolInputs.push(slowQueryInput);
      }
      evidence.push(...topSlowSql.evidence.slice(0, 1));
      recommendedNextTools.add("diagnose_slow_query");
      if ((leadSql.avgLockTimeMs ?? 0) >= 10) {
        recommendedNextTools.add("diagnose_lock_contention");
      }

      scoreCategory(
        "slow_sql",
        input.symptom === "cpu"
          ? 4
          : input.symptom === "latency" || input.symptom === "timeout"
            ? 3
            : 2,
      );
    }
    for (const limitation of topSlowSql.limitations ?? []) {
      limitations.add(limitation);
    }

    if (lockContention) {
      for (const limitation of lockContention.limitations ?? []) {
        limitations.add(limitation);
      }
      if (lockContention.status === "ok") {
        const leadBlocker = lockContention.suspiciousEntities?.sessions?.[0];
        const leadTable = lockContention.suspiciousEntities?.tables?.[0];
        const leadRootCause = lockContention.rootCauseCandidates[0];

        if (leadBlocker) {
          topCandidates.push({
            type: "session",
            title: leadBlocker.sessionId
              ? `Blocking session ${leadBlocker.sessionId}`
              : "Blocking session hotspot",
            confidence: leadRootCause?.confidence ?? "medium",
            sessionId: leadBlocker.sessionId,
            rationale: leadBlocker.reason,
          });
        }
        if (leadTable) {
          topCandidates.push({
            type: "table",
            title: `Hot locked table ${leadTable.table}`,
            confidence: lockContention.rootCauseCandidates.some(
              (candidate) => candidate.code === "lock_contention_hot_table",
            )
              ? "high"
              : (leadRootCause?.confidence ?? "medium"),
            table: leadTable.table,
            rationale: leadTable.reason,
          });
        }

        evidence.push(...lockContention.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_lock_contention");
        recommendedNextTools.add("show_processlist");
        nextToolInputs.push(
          buildLockContentionNextToolInput(
            {
              table: leadTable?.table,
              blockerSessionId: leadBlocker?.sessionId,
            },
            input,
            "Inspect the lock-wait candidate identified by the service-latency symptom route.",
          ),
          buildShowProcesslistNextToolInput(
            {
              command: "Query",
              includeIdle: false,
              includeInfo: true,
            },
            input,
            "Review live running sessions around the lock-contention signal.",
          ),
        );

        const lockScoreBase =
          input.symptom === "timeout" ? 5 : input.symptom === "latency" ? 4 : 2;
        scoreCategory(
          "lock_contention",
          lockContention.rootCauseCandidates.some(
            (candidate) =>
              candidate.code === "lock_contention_single_blocker_hotspot",
          )
            ? lockScoreBase + 1
            : lockScoreBase,
        );
      }
    }

    for (const limitation of connectionSpike.limitations ?? []) {
      limitations.add(limitation);
    }
    if (connectionSpike.status === "ok") {
      const focusUser = connectionSpike.suspiciousEntities?.users?.[0];
      const focusSession = connectionSpike.suspiciousEntities?.sessions?.[0];
      const leadRootCause = connectionSpike.rootCauseCandidates[0];
      topCandidates.push({
        type: "session",
        title: focusUser?.user
          ? `Connection growth around user ${focusUser.user}`
          : focusSession?.sessionId
            ? `Connection growth around session ${focusSession.sessionId}`
            : "Connection growth hotspot",
        confidence: leadRootCause?.confidence ?? "medium",
        sessionId: focusSession?.sessionId,
        rationale:
          focusUser?.reason ??
          focusSession?.reason ??
          "A live processlist snapshot suggests connection growth around a focused user or long-running sessions.",
      });
      evidence.push(...connectionSpike.evidence.slice(0, 2));
      recommendedNextTools.add("diagnose_connection_spike");
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildConnectionSpikeNextToolInput(
          {
            user: focusUser?.user ?? input.user,
            clientHost: focusUser?.clientHost ?? input.clientHost,
          },
          input,
          "Inspect the connection-growth candidate identified by the service-latency symptom route.",
        ),
        buildShowProcesslistNextToolInput(
          {
            user: focusUser?.user ?? input.user,
            host: focusUser?.clientHost ?? input.clientHost,
            includeIdle: true,
            includeInfo: true,
          },
          input,
          "Review live sessions for idle buildup or long-running queries around the connection signal.",
        ),
      );

      const connectionScoreBase =
        input.symptom === "connection_growth"
          ? 5
          : input.symptom === "latency" || input.symptom === "timeout"
            ? 2
            : 1;
      scoreCategory(
        "connection_spike",
        connectionSpike.rootCauseCandidates.some(
          (candidate) =>
            candidate.code === "connection_spike_idle_session_accumulation",
        )
          ? connectionScoreBase + 1
          : connectionScoreBase,
      );
    }

    if (metrics.length > 0) {
      evidence.push(
        ...metrics.slice(0, 4).map((metric) => ({
          source: "ces_metrics",
          title: `CES ${metric.alias}`,
          summary: metricSummaryText(metric),
        })),
      );
      if ((cpuMetric?.max ?? 0) >= 80 || (memMetric?.max ?? 0) >= 90) {
        topCandidates.push({
          type: "session",
          title: "Instance resource pressure from CES metrics",
          confidence:
            (cpuMetric?.max ?? 0) >= 90 || (memMetric?.max ?? 0) >= 95
              ? "high"
              : "medium",
          rationale: `Cloud Eye metrics show instance resource pressure${cpuMetric?.max !== undefined ? `; max_cpu=${roundMetric(cpuMetric.max)}` : ""}${memMetric?.max !== undefined ? `, max_mem=${roundMetric(memMetric.max)}` : ""}.`,
        });
        recommendedNextTools.add("diagnose_storage_pressure");
        scoreCategory("resource_pressure", input.symptom === "cpu" ? 6 : 3);
      }
      if (
        (writeDelayMetric?.max ?? 0) >= 50 ||
        (readDelayMetric?.max ?? 0) >= 50
      ) {
        recommendedNextTools.add("diagnose_storage_pressure");
        scoreCategory("resource_pressure", 4);
      }
      if ((connectionUsageMetric?.max ?? 0) >= 80) {
        recommendedNextTools.add("diagnose_connection_spike");
        scoreCategory(
          "connection_spike",
          input.symptom === "connection_growth" ? 6 : 3,
        );
      }
      if ((slowQueriesMetric?.max ?? 0) > 0) {
        recommendedNextTools.add("find_top_slow_sql");
        recommendedNextTools.add("diagnose_slow_query");
        scoreCategory("slow_sql", input.symptom === "latency" ? 4 : 2);
      }
      if ((replicationDelayMetric?.max ?? 0) >= 60) {
        recommendedNextTools.add("diagnose_replication_lag");
        scoreCategory("resource_pressure", 3);
      }
    } else {
      for (const limitation of metricsSourceLimitation(this.metricsSource)) {
        limitations.add(limitation);
      }
    }

    const scoredCategories = [...categoryScores.entries()]
      .filter(([, score]) => score > 0)
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          serviceCategoryPriority(right[0]) - serviceCategoryPriority(left[0]),
      );

    const fallbackCategory: ServiceLatencySuspectedCategory =
      input.symptom === "cpu"
        ? "resource_pressure"
        : input.symptom === "connection_growth"
          ? "connection_spike"
          : input.symptom === "timeout"
            ? "lock_contention"
            : "slow_sql";

    const suspectedCategory =
      scoredCategories.length === 0
        ? fallbackCategory
        : scoredCategories.length > 1 &&
            scoredCategories[0][1] === scoredCategories[1][1]
          ? "mixed"
          : scoredCategories[0][0];

    if (suspectedCategory === "resource_pressure") {
      recommendedNextTools.add("diagnose_storage_pressure");
      if (!this.metricsSource) {
        limitations.add(
          "Resource-pressure routing is heuristic because no CPU, IOPS, or instance-metric collector is configured yet.",
        );
      }
    }

    const sortedCandidates = [...topCandidates]
      .sort(
        (left, right) =>
          confidenceWeight(right.confidence) -
            confidenceWeight(left.confidence) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, maxCandidates);

    const summary =
      sortedCandidates.length > 0
        ? suspectedCategory === "mixed"
          ? "Service-latency diagnosis found mixed SQL, lock, or connection signals"
          : `Service-latency diagnosis points to ${suspectedCategory.replace(/_/g, " ")} as the dominant suspect`
        : "Service-latency diagnosis did not isolate a dominant suspect from current SQL, lock, or connection evidence";

    return {
      tool: "diagnose_service_latency",
      status: sortedCandidates.length > 0 ? "ok" : "inconclusive",
      summary: withDatasourceSummary(summary, ctx.datasource),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      suspectedCategory,
      topCandidates: sortedCandidates,
      evidence: evidence.slice(0, 5),
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(
        0,
        maxCandidates,
      ),
      limitations: [...limitations].slice(0, 5),
    };
  }

  async diagnoseDbHotspot(
    input: DiagnoseDbHotspotInput,
    ctx: SessionContext,
  ): Promise<DbHotspotResult> {
    const maxCandidates = clampInteger(input.maxCandidates, 5, 1, 10);
    const scope = input.scope ?? "all";
    const hotspots: DbHotspotResult["hotspots"] = [];
    const evidence: DbHotspotResult["evidence"] = [];
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];
    const limitations = new Set<string>();

    if (scope === "all" || scope === "sql") {
      const topSlowSql = await this.findTopSlowSql(
        {
          ...input,
          topN: Math.min(maxCandidates, 5),
          sortBy: "total_latency",
        },
        ctx,
      );
      for (const limitation of topSlowSql.limitations ?? []) {
        limitations.add(limitation);
      }
      if (topSlowSql.status === "ok") {
        for (const sql of topSlowSql.topSqls.slice(
          0,
          Math.min(maxCandidates, 3),
        )) {
          hotspots.push({
            type: "sql",
            title: sql.digestText
              ? `Top SQL hotspot: ${sql.digestText}`
              : "Top SQL hotspot",
            confidence:
              (sql.totalLatencyMs ?? 0) >= 1000 ||
              (sql.avgLatencyMs ?? 0) >= 100
                ? "high"
                : (sql.totalLatencyMs ?? 0) > 0 || (sql.avgLatencyMs ?? 0) > 0
                  ? "medium"
                  : "low",
            sqlHash: sql.sqlHash,
            digestText: sql.digestText,
            sampleSql: sql.sampleSql,
            rationale: `Ranked in digest summaries${sql.totalLatencyMs !== undefined ? `; total_latency_ms=${sql.totalLatencyMs}` : ""}${sql.avgLatencyMs !== undefined ? `, avg_latency_ms=${sql.avgLatencyMs}` : ""}${sql.execCount !== undefined ? `, exec_count=${sql.execCount}` : ""}${sql.avgRowsExamined !== undefined ? `, avg_rows_examined=${sql.avgRowsExamined}` : ""}.`,
            evidenceSources: sql.evidenceSources,
            recommendation:
              sql.recommendation ??
              "Use diagnose_slow_query to inspect the SQL hotspot in more detail.",
          });
          const slowQueryInput = buildSlowQueryNextToolInput(
            sql,
            input,
            "Analyze this SQL hotspot from database-hotspot aggregation.",
          );
          if (slowQueryInput) {
            nextToolInputs.push(slowQueryInput);
          }
        }
        evidence.push(...topSlowSql.evidence.slice(0, 1));
        recommendedNextTools.add("find_top_slow_sql");
        recommendedNextTools.add("diagnose_slow_query");
      }
    }

    if (scope === "all" || scope === "table" || scope === "session") {
      const lockContention = await this.diagnoseLockContention(
        {
          ...input,
          maxCandidates: Math.min(maxCandidates, 3),
        },
        ctx,
      );
      for (const limitation of lockContention.limitations ?? []) {
        limitations.add(limitation);
      }
      if (lockContention.status === "ok") {
        if (scope === "all" || scope === "session") {
          for (const session of lockContention.suspiciousEntities?.sessions?.slice(
            0,
            2,
          ) ?? []) {
            hotspots.push({
              type: "session",
              title: session.sessionId
                ? `Blocking session hotspot ${session.sessionId}`
                : "Blocking session hotspot",
              confidence: lockContention.rootCauseCandidates.some(
                (candidate) =>
                  candidate.code === "lock_contention_single_blocker_hotspot",
              )
                ? "high"
                : "medium",
              sessionId: session.sessionId,
              rationale: session.reason,
              evidenceSources: ["lock_waits"],
              recommendation:
                "Use diagnose_lock_contention and show_processlist to inspect blocker SQL and transaction age.",
            });
            nextToolInputs.push(
              buildLockContentionNextToolInput(
                { blockerSessionId: session.sessionId },
                input,
                "Inspect this blocking-session hotspot with lock-wait context.",
              ),
              buildShowProcesslistNextToolInput(
                {
                  command: "Query",
                  includeIdle: false,
                  includeInfo: true,
                },
                input,
                "Review live running sessions around this blocking-session hotspot.",
              ),
            );
          }
        }
        if (scope === "all" || scope === "table") {
          for (const table of lockContention.suspiciousEntities?.tables?.slice(
            0,
            2,
          ) ?? []) {
            hotspots.push({
              type: "table",
              title: `Locked table hotspot ${table.table}`,
              confidence: lockContention.rootCauseCandidates.some(
                (candidate) => candidate.code === "lock_contention_hot_table",
              )
                ? "high"
                : "medium",
              table: table.table,
              rationale: table.reason,
              evidenceSources: ["lock_waits"],
              recommendation:
                "Use diagnose_lock_contention to inspect wait chains and reduce lock hold time on this table.",
            });
            nextToolInputs.push(
              buildLockContentionNextToolInput(
                { table: table.table },
                input,
                "Inspect this locked-table hotspot with lock-wait context.",
              ),
            );
          }
        }
        evidence.push(...lockContention.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_lock_contention");
        recommendedNextTools.add("show_processlist");
      }
    }

    if (scope === "all" || scope === "session") {
      const connectionSpike = await this.diagnoseConnectionSpike(
        {
          ...input,
          compareBaseline: false,
          maxCandidates: Math.min(maxCandidates, 3),
        },
        ctx,
      );
      for (const limitation of connectionSpike.limitations ?? []) {
        limitations.add(limitation);
      }
      if (connectionSpike.status === "ok") {
        const focusUser = connectionSpike.suspiciousEntities?.users?.[0];
        const focusSession = connectionSpike.suspiciousEntities?.sessions?.[0];
        hotspots.push({
          type: "session",
          title: focusUser?.user
            ? `Connection hotspot around user ${focusUser.user}`
            : focusSession?.sessionId
              ? `Connection hotspot around session ${focusSession.sessionId}`
              : "Connection hotspot",
          confidence: connectionSpike.rootCauseCandidates.some(
            (candidate) =>
              candidate.code === "connection_spike_idle_session_accumulation",
          )
            ? "high"
            : "medium",
          sessionId: focusSession?.sessionId,
          rationale:
            focusUser?.reason ??
            focusSession?.reason ??
            "A live processlist snapshot suggests a session-level hotspot around connection growth.",
          evidenceSources: ["processlist"],
          recommendation:
            "Use diagnose_connection_spike and show_processlist to inspect idle buildup and long-running sessions.",
        });
        nextToolInputs.push(
          buildConnectionSpikeNextToolInput(
            {
              user: focusUser?.user,
              clientHost: focusUser?.clientHost,
            },
            input,
            "Inspect this connection hotspot with connection-growth diagnostics.",
          ),
          buildShowProcesslistNextToolInput(
            {
              user: focusUser?.user,
              host: focusUser?.clientHost,
              includeIdle: true,
              includeInfo: true,
            },
            input,
            "Review live sessions for this connection hotspot.",
          ),
        );
        evidence.push(...connectionSpike.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_connection_spike");
        recommendedNextTools.add("show_processlist");
      }
    }

    const dedupedHotspots = hotspots
      .filter((item, index, allItems) => {
        const key = `${item.type}:${item.sqlHash ?? ""}:${item.digestText ?? ""}:${item.sessionId ?? ""}:${item.table ?? ""}:${item.title}`;
        return (
          allItems.findIndex((candidate) => {
            const candidateKey = `${candidate.type}:${candidate.sqlHash ?? ""}:${candidate.digestText ?? ""}:${candidate.sessionId ?? ""}:${candidate.table ?? ""}:${candidate.title}`;
            return candidateKey === key;
          }) === index
        );
      })
      .sort(
        (left, right) =>
          confidenceWeight(right.confidence) -
            confidenceWeight(left.confidence) ||
          hotspotTypePriority(right.type) - hotspotTypePriority(left.type) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, maxCandidates);

    if (scope === "table") {
      limitations.add(
        "Table hotspots currently rely on lock-wait evidence only; no table-level IO, scan, or storage metric collector is connected yet.",
      );
    }
    if (scope === "session") {
      limitations.add(
        "Session hotspots currently rely on processlist and lock-wait snapshots only; no CPU or per-session resource metric collector is connected yet.",
      );
    }

    return {
      tool: "diagnose_db_hotspot",
      status: dedupedHotspots.length > 0 ? "ok" : "inconclusive",
      summary: withDatasourceSummary(
        dedupedHotspots.length > 0
          ? `Database hotspot diagnosis collected ${dedupedHotspots.length} hotspot candidates`
          : "Database hotspot diagnosis did not isolate a hotspot from current SQL, lock, or processlist evidence",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      scope,
      hotspots: dedupedHotspots,
      evidence: evidence.slice(0, 5),
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(
        0,
        maxCandidates,
      ),
      limitations: [...limitations].slice(0, 5),
    };
  }

  async findTopSlowSql(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<FindTopSlowSqlResult> {
    try {
      const [digestRows, externalTopSqls] = await Promise.all([
        this.findTopStatementDigests(input, ctx).catch(
          () => [] as StatementDigestRow[],
        ),
        this.slowSqlSource?.findTop
          ? this.slowSqlSource.findTop(input, ctx).catch(() => [])
          : Promise.resolve([] as ExternalSlowSqlSample[]),
      ]);

      if (digestRows.length === 0 && externalTopSqls.length === 0) {
        return {
          tool: "find_top_slow_sql",
          status: "inconclusive",
          summary: withDatasourceSummary(
            "No statement digest ranking evidence was available for top slow SQL discovery",
            ctx.datasource,
          ),
          diagnosisWindow: {
            from: input.timeRange?.from,
            to: input.timeRange?.to,
            relative: input.timeRange?.relative,
          },
          topSqls: [],
          evidence: [
            {
              source: "statement_digest",
              title: "Statement digest ranking",
              summary:
                "No matching rows were returned from performance_schema.events_statements_summary_by_digest, and no external Taurus slow-SQL ranking was available.",
            },
          ],
          limitations: [
            this.slowSqlSource?.findTop
              ? "Neither performance_schema digest ranking nor the configured external Taurus slow-SQL ranking returned usable rows."
              : "This discovery currently depends on performance_schema digest summaries being enabled and populated.",
            "The selected time_range is not yet enforced against cumulative digest counters; current ranking reflects retained digest summaries.",
          ],
        };
      }

      const digestTopSqls = digestRows.map((row) => {
        const evidenceSources = ["statement_digest"];
        const recommendationParts = [];
        if (row.querySampleText || row.digestText) {
          recommendationParts.push(
            "Run diagnose_slow_query with sql or digest_text to analyze the dominant bottleneck.",
          );
        }
        if ((row.avgLockTimeMs ?? 0) >= 10) {
          recommendationParts.push(
            "Correlate with diagnose_lock_contention if lock time remains elevated.",
          );
        }
        if ((row.execCount ?? 0) >= 20 && (row.avgLatencyMs ?? 0) < 50) {
          recommendationParts.push(
            "Review high-frequency workload shape before focusing only on single-query latency.",
          );
        }

        return {
          sqlHash: row.querySampleText
            ? sqlHash(normalizeSql(row.querySampleText))
            : undefined,
          digestText: row.digestText,
          sampleSql: row.querySampleText,
          avgLatencyMs: row.avgLatencyMs,
          totalLatencyMs: row.totalLatencyMs,
          execCount: row.execCount,
          avgLockTimeMs: row.avgLockTimeMs,
          avgRowsExamined: row.avgRowsExamined,
          evidenceSources,
          recommendation:
            recommendationParts.length > 0
              ? recommendationParts.join(" ")
              : "Review this digest with diagnose_slow_query if it aligns with the reported symptom window.",
        };
      });
      const externalMappedSqls = externalTopSqls.map((sample) => {
        const recommendationParts = [
          "Run diagnose_slow_query with sql or digest_text to analyze the dominant bottleneck.",
        ];
        if ((sample.avgLockTimeMs ?? 0) >= 10) {
          recommendationParts.push(
            "Correlate with diagnose_lock_contention if lock time remains elevated.",
          );
        }
        if ((sample.execCount ?? 0) >= 20 && (sample.avgLatencyMs ?? 0) < 50) {
          recommendationParts.push(
            "Review high-frequency workload shape before focusing only on single-query latency.",
          );
        }
        return {
          sqlHash: sample.sqlHash,
          digestText: sample.digestText,
          sampleSql: sample.sql,
          avgLatencyMs: sample.avgLatencyMs,
          totalLatencyMs:
            sample.avgLatencyMs !== undefined
              ? sample.avgLatencyMs * Math.max(sample.execCount ?? 1, 1)
              : undefined,
          execCount: sample.execCount,
          avgLockTimeMs: sample.avgLockTimeMs,
          avgRowsExamined: sample.avgRowsExamined,
          evidenceSources: [sample.source],
          recommendation: recommendationParts.join(" "),
        };
      });
      const mergedTopSqls = [...digestTopSqls];
      for (const externalSql of externalMappedSqls) {
        const existingIndex = mergedTopSqls.findIndex(
          (item) =>
            (externalSql.sqlHash && item.sqlHash === externalSql.sqlHash) ||
            (externalSql.digestText &&
              item.digestText === externalSql.digestText) ||
            (externalSql.sampleSql && item.sampleSql === externalSql.sampleSql),
        );
        if (existingIndex >= 0) {
          const existing = mergedTopSqls[existingIndex];
          mergedTopSqls[existingIndex] = {
            ...existing,
            sampleSql: existing.sampleSql ?? externalSql.sampleSql,
            avgLatencyMs: existing.avgLatencyMs ?? externalSql.avgLatencyMs,
            totalLatencyMs:
              existing.totalLatencyMs ?? externalSql.totalLatencyMs,
            execCount: existing.execCount ?? externalSql.execCount,
            avgLockTimeMs:
              existing.avgLockTimeMs ?? externalSql.avgLockTimeMs,
            avgRowsExamined:
              existing.avgRowsExamined ?? externalSql.avgRowsExamined,
            evidenceSources: [
              ...new Set([
                ...existing.evidenceSources,
                ...externalSql.evidenceSources,
              ]),
            ],
          };
        } else {
          mergedTopSqls.push(externalSql);
        }
      }
      const topSqls = mergedTopSqls
        .sort((left, right) => {
          const leftAvgLatency = left.avgLatencyMs ?? 0;
          const rightAvgLatency = right.avgLatencyMs ?? 0;
          const leftTotalLatency = left.totalLatencyMs ?? 0;
          const rightTotalLatency = right.totalLatencyMs ?? 0;
          const leftExecCount = left.execCount ?? 0;
          const rightExecCount = right.execCount ?? 0;
          const leftLockTime = left.avgLockTimeMs ?? 0;
          const rightLockTime = right.avgLockTimeMs ?? 0;
          switch (input.sortBy) {
            case "avg_latency":
              return (
                rightAvgLatency - leftAvgLatency ||
                rightTotalLatency - leftTotalLatency
              );
            case "exec_count":
              return (
                rightExecCount - leftExecCount ||
                rightTotalLatency - leftTotalLatency
              );
            case "lock_time":
              return (
                rightLockTime - leftLockTime ||
                rightTotalLatency - leftTotalLatency
              );
            default:
              return (
                rightTotalLatency - leftTotalLatency ||
                rightAvgLatency - leftAvgLatency
              );
          }
        })
        .slice(0, clampInteger(input.topN, 5, 1, 20));

      return {
        tool: "find_top_slow_sql",
        status: "ok",
        summary: withDatasourceSummary(
          `Top slow SQL discovery collected ${topSqls.length} suspect statements`,
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        topSqls,
        evidence: [
          ...(digestRows.length > 0
            ? [
                {
                  source: "statement_digest",
                  title: "Statement digest ranking",
                  summary: `Collected ${digestRows.length} ranked rows from performance_schema.events_statements_summary_by_digest ordered by ${input.sortBy ?? "total_latency"}.`,
                },
              ]
            : []),
          ...(externalTopSqls.length > 0
            ? [
                {
                  source: externalTopSqls[0].source,
                  title: "External Taurus slow SQL ranking",
                  summary: `Collected ${externalTopSqls.length} ranked rows from the configured Taurus slow-SQL source ordered by ${input.sortBy ?? "total_latency"}.`,
                  rawRef: externalTopSqls[0].rawRef,
                },
              ]
            : []),
        ],
        limitations: [
          ...(digestRows.length > 0
            ? [
                "The selected time_range is not yet enforced against cumulative digest counters; current ranking reflects retained digest summaries.",
              ]
            : []),
          ...(externalTopSqls.length > 0
            ? [
                "External Taurus slow-SQL ranking depends on the configured API retention window and may not cover every statement in the requested time range.",
              ]
            : []),
        ],
      };
    } catch (error) {
      return {
        tool: "find_top_slow_sql",
        status: "inconclusive",
        summary: withDatasourceSummary(
          "Top slow SQL discovery could not collect digest ranking evidence",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        topSqls: [],
        evidence: [
          {
            source: "statement_digest",
            title: "Statement digest ranking unavailable",
            summary:
              error instanceof Error
                ? error.message
                : "Digest ranking query failed unexpectedly.",
          },
        ],
        limitations: [
          "This discovery currently depends on performance_schema digest summaries being accessible from the selected datasource.",
        ],
      };
    }
  }

  async diagnoseConnectionSpike(
    input: DiagnoseConnectionSpikeInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const [processlist, metrics] = await Promise.all([
      this.showProcesslist(
        {
          user: input.user,
          host: input.clientHost,
          includeIdle: true,
          includeSystem: false,
          includeInfo: false,
          maxRows: evidenceRowLimit(input.evidenceLevel),
        },
        ctx,
      ),
      queryMetricsSafely(
        this.metricsSource,
        [
          "connection_count",
          "active_connection_count",
          "connection_usage",
          "qps",
        ],
        input,
        ctx,
      ),
    ]);
    const rows = parseProcesslistRows(processlist);
    const connectionCountMetric = pickMetric(metrics, "connection_count");
    const activeConnectionMetric = pickMetric(
      metrics,
      "active_connection_count",
    );
    const connectionUsageMetric = pickMetric(metrics, "connection_usage");
    const qpsMetric = pickMetric(metrics, "qps");
    const metricEvidence = metrics.map((metric) => ({
      source: "ces_metrics",
      title: `CES ${metric.alias}`,
      summary: metricSummaryText(metric),
    }));

    if (rows.length === 0) {
      const metricOnlySpike =
        (connectionUsageMetric?.max ?? 0) >= 80 ||
        (connectionCountMetric?.max ?? 0) >= 100 ||
        (activeConnectionMetric?.max ?? 0) >= 50;
      if (metricOnlySpike) {
        return {
          tool: "diagnose_connection_spike",
          status: "ok",
          severity:
            (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "warning",
          summary: withDatasourceSummary(
            "Connection-spike diagnosis found CES connection pressure but no matching live sessions",
            ctx.datasource,
          ),
          diagnosisWindow: {
            from: input.timeRange?.from,
            to: input.timeRange?.to,
            relative: input.timeRange?.relative,
          },
          rootCauseCandidates: [
            {
              code: "connection_spike_ces_connection_pressure",
              title: "Control-plane metrics show connection pressure",
              confidence:
                (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "medium",
              rationale: `CES connection metrics crossed the current thresholds${connectionUsageMetric?.max !== undefined ? `; max_connection_usage=${roundMetric(connectionUsageMetric.max)}` : ""}${connectionCountMetric?.max !== undefined ? `, max_connection_count=${roundMetric(connectionCountMetric.max)}` : ""}${activeConnectionMetric?.max !== undefined ? `, max_active_connections=${roundMetric(activeConnectionMetric.max)}` : ""}.`,
            },
          ],
          keyFindings: [
            "No matching processlist rows were available in the current snapshot.",
            connectionUsageMetric
              ? `CES connection usage: ${metricSummaryText(connectionUsageMetric)}.`
              : "CES connection usage metric was not returned.",
            connectionCountMetric
              ? `CES connection count: ${metricSummaryText(connectionCountMetric)}.`
              : "CES connection count metric was not returned.",
          ],
          suspiciousEntities: input.user
            ? {
                users: [
                  {
                    user: input.user,
                    clientHost: input.clientHost,
                    reason:
                      "Provided as the diagnosis focus; CES showed connection pressure but the live snapshot did not contain matching sessions.",
                  },
                ],
              }
            : undefined,
          evidence: [
            {
              source: "processlist",
              title: "Current processlist snapshot",
              summary:
                "No matching sessions were returned from information_schema.PROCESSLIST.",
            },
            ...metricEvidence,
          ],
          recommendedActions: [
            "Re-run show_processlist during the spike window with include_idle=true and include_info=true.",
            "Correlate CES connection pressure with application deploys, retry storms, and pool-size settings.",
          ],
          limitations: [
            "Live processlist evidence was not available for the observed CES spike window.",
          ],
        };
      }
      return {
        tool: "diagnose_connection_spike",
        status: "inconclusive",
        severity: "info",
        summary: withDatasourceSummary(
          "No matching processlist sessions were observed for connection-spike diagnosis",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "connection_spike_no_matching_sessions",
            title: "No matching live sessions observed",
            confidence: "low",
            rationale:
              "The current processlist snapshot did not contain sessions matching the requested user or client-host filters.",
          },
        ],
        keyFindings: [
          input.user
            ? `No current processlist rows matched user ${input.user}.`
            : "No current processlist rows were returned.",
          input.clientHost
            ? `No current processlist rows matched host prefix ${input.clientHost}.`
            : "No host filter was applied.",
        ],
        suspiciousEntities: input.user
          ? {
              users: [
                {
                  user: input.user,
                  clientHost: input.clientHost,
                  reason:
                    "Provided as the diagnosis focus, but no matching live sessions were observed in the current snapshot.",
                },
              ],
            }
          : undefined,
        evidence: [
          {
            source: "processlist",
            title: "Current processlist snapshot",
            summary:
              "No matching sessions were returned from information_schema.PROCESSLIST.",
          },
          ...metricEvidence,
        ],
        recommendedActions: [
          "Re-run the diagnostic during the spike window to capture live sessions.",
          "Use show_processlist with broader filters or include_idle=true to inspect connection buildup.",
        ],
        limitations: [
          "This diagnostic currently uses a point-in-time processlist snapshot only.",
          ...metricsSourceLimitation(this.metricsSource),
        ],
      };
    }

    const sleepSessions = rows.filter((row) => row.command === "Sleep");
    const activeSessions = rows.filter((row) => row.command !== "Sleep");
    const longRunningSessions = rows.filter(
      (row) => (row.timeSeconds ?? 0) >= 60,
    );
    const userCounts = countBy(rows, (row) => row.user);
    const hostCounts = countBy(rows, (row) => row.host);
    const topUser = userCounts[0];
    const topHost = hostCounts[0];
    const longestSessions = [...rows]
      .sort((left, right) => (right.timeSeconds ?? 0) - (left.timeSeconds ?? 0))
      .slice(0, 3);

    const rootCauseCandidates: DiagnosticResult["rootCauseCandidates"] = [];
    if (sleepSessions.length >= Math.max(5, Math.ceil(rows.length * 0.6))) {
      rootCauseCandidates.push({
        code: "connection_spike_idle_session_accumulation",
        title: "Idle session accumulation",
        confidence: rows.length >= 10 ? "high" : "medium",
        rationale: `${sleepSessions.length} of ${rows.length} matching sessions are idle (Sleep), which usually points to pooling saturation or clients holding connections open.`,
      });
    }
    if (activeSessions.length >= Math.max(3, Math.ceil(rows.length * 0.4))) {
      rootCauseCandidates.push({
        code: "connection_spike_active_query_backlog",
        title: "Active query backlog",
        confidence: activeSessions.length >= 8 ? "high" : "medium",
        rationale: `${activeSessions.length} matching sessions are active, suggesting requests may be piling up behind slow or blocked work.`,
      });
    }
    if (topUser && topUser.count >= Math.max(3, Math.ceil(rows.length * 0.5))) {
      rootCauseCandidates.push({
        code: "connection_spike_single_user_hotspot",
        title: "Single-user hotspot",
        confidence: topUser.count >= 8 ? "high" : "medium",
        rationale: `User ${topUser.key} accounts for ${topUser.count} of ${rows.length} matching sessions, which suggests a concentrated source of connection growth.`,
      });
    }
    if (longRunningSessions.length > 0) {
      rootCauseCandidates.push({
        code: "connection_spike_long_running_sessions",
        title: "Long-running sessions are holding connections",
        confidence: longRunningSessions.length >= 3 ? "high" : "medium",
        rationale: `${longRunningSessions.length} matching sessions have been active for at least 60 seconds, which can reduce pool turnover and amplify connection growth.`,
      });
    }
    if (
      (connectionUsageMetric?.max ?? 0) >= 80 ||
      (connectionCountMetric?.max ?? 0) >= 100
    ) {
      rootCauseCandidates.push({
        code: "connection_spike_ces_connection_pressure",
        title: "CES metrics confirm connection pressure",
        confidence: (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "medium",
        rationale: `Cloud Eye connection metrics crossed the current pressure thresholds${connectionUsageMetric?.max !== undefined ? `; max_connection_usage=${roundMetric(connectionUsageMetric.max)}` : ""}${connectionCountMetric?.max !== undefined ? `, max_connection_count=${roundMetric(connectionCountMetric.max)}` : ""}.`,
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "connection_spike_snapshot_collected",
        title: "Connection spike snapshot collected",
        confidence: "low",
        rationale:
          "A live processlist snapshot was collected, but no single dominant pattern crossed the current heuristic thresholds.",
      });
    }

    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const severity: DiagnosticResult["severity"] =
      rows.length >= 40 ||
      activeSessions.length >= 15 ||
      longRunningSessions.length >= 5
        ? "high"
        : rows.length >= 15 ||
            activeSessions.length >= 5 ||
            longRunningSessions.length >= 2
          ? "warning"
          : "info";

    const suspiciousUsers = [];
    if (input.user) {
      suspiciousUsers.push({
        user: input.user,
        clientHost: input.clientHost,
        reason: "Provided as the connection-spike focus.",
      });
    } else if (topUser) {
      suspiciousUsers.push({
        user: topUser.key,
        clientHost: topHost?.key,
        reason: `Top user in current processlist snapshot with ${topUser.count} sessions.`,
      });
    }

    const suspiciousSessions = longestSessions.map((row) => ({
      sessionId: row.sessionId,
      user: row.user,
      state: row.state ?? row.command,
      reason:
        row.timeSeconds !== undefined
          ? `Observed in the longest-running processlist sessions (${row.timeSeconds}s).`
          : "Observed in the current processlist snapshot.",
    }));

    const keyFindings = [
      `Collected ${rows.length} matching processlist sessions (${activeSessions.length} active, ${sleepSessions.length} idle).`,
      topUser
        ? `Top user ${topUser.key} accounts for ${topUser.count} sessions.`
        : "No dominant user was identified in the current snapshot.",
      longRunningSessions.length > 0
        ? `${longRunningSessions.length} sessions have been active for at least 60 seconds.`
        : "No long-running sessions (>=60s) were observed in the current snapshot.",
    ];
    if (input.compareBaseline) {
      keyFindings.push(
        this.metricsSource
          ? "Baseline comparison was requested; CES connection metrics were collected for the requested time window."
          : "Baseline comparison was requested, but only a live processlist snapshot is currently available.",
      );
    }
    if (connectionUsageMetric) {
      keyFindings.push(
        `CES connection usage: ${metricSummaryText(connectionUsageMetric)}.`,
      );
    }
    if (connectionCountMetric) {
      keyFindings.push(
        `CES connection count: ${metricSummaryText(connectionCountMetric)}.`,
      );
    }
    if (activeConnectionMetric) {
      keyFindings.push(
        `CES active connections: ${metricSummaryText(activeConnectionMetric)}.`,
      );
    }
    if (qpsMetric) {
      keyFindings.push(`CES QPS: ${metricSummaryText(qpsMetric)}.`);
    }

    const recommendedActions = [
      "Use show_processlist with include_info=true to inspect the longest-running sessions in more detail.",
      "Correlate the snapshot with application deploys, retry storms, and pool-size settings.",
    ];
    if (sleepSessions.length >= Math.max(5, Math.ceil(rows.length * 0.6))) {
      recommendedActions.push(
        "Inspect client pooling, idle timeout, and connection reuse behavior for excessive Sleep sessions.",
      );
    }
    if (activeSessions.length >= Math.max(3, Math.ceil(rows.length * 0.4))) {
      recommendedActions.push(
        "Review slow or blocked active sessions with explain_sql / explain_sql_enhanced and lock diagnostics.",
      );
    }
    if ((connectionUsageMetric?.max ?? 0) >= 80) {
      recommendedActions.push(
        "Check configured max connections and application pool concurrency because CES connection usage crossed 80%.",
      );
    }

    const evidence = [
      {
        source: "processlist",
        title: "Current processlist snapshot",
        summary: `Snapshot captured ${rows.length} matching sessions, including ${activeSessions.length} active and ${sleepSessions.length} idle sessions.`,
      },
      {
        source: "processlist",
        title: "Dominant user and host distribution",
        summary:
          topUser || topHost
            ? `Top user: ${topUser?.key ?? "n/a"} (${topUser?.count ?? 0}); top host: ${topHost?.key ?? "n/a"} (${topHost?.count ?? 0}).`
            : "No dominant user or host distribution was identified.",
      },
      ...metricEvidence,
    ];

    return {
      tool: "diagnose_connection_spike",
      status: "ok",
      severity,
      summary: withDatasourceSummary(
        `Connection-spike diagnosis collected a live processlist snapshot with ${rows.length} matching sessions`,
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities:
        suspiciousUsers.length > 0 || suspiciousSessions.length > 0
          ? {
              users: suspiciousUsers.length > 0 ? suspiciousUsers : undefined,
              sessions:
                suspiciousSessions.length > 0 ? suspiciousSessions : undefined,
            }
          : undefined,
      evidence,
      recommendedActions: [...new Set(recommendedActions)],
      limitations: [
        "This diagnostic currently relies on a point-in-time processlist snapshot only.",
        ...metricsSourceLimitation(this.metricsSource),
      ],
    };
  }

  async diagnoseLockContention(
    input: DiagnoseLockContentionInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const [lockWaits, metadataLockRows, latestDeadlock] = await Promise.all([
      this.showLockWaits(
        {
          table: input.table,
          blockerSessionId: input.blockerSessionId,
          includeSql: false,
          maxRows: lockEvidenceRowLimit(input.evidenceLevel),
        },
        ctx,
      ),
      this.findMetadataLockWaits(input, ctx),
      this.findLatestDeadlock(ctx),
    ]);
    const rows = parseLockWaitRows(lockWaits);
    const metadataTables = countBy(metadataLockRows, (row) =>
      row.objectSchema && row.objectName
        ? `${row.objectSchema}.${row.objectName}`
        : row.objectName,
    );
    const metadataBlockers = countBy(
      metadataLockRows,
      (row) => row.blockingSessionId,
    );
    const topMetadataTable = metadataTables[0];
    const topMetadataBlocker = metadataBlockers[0];

    if (
      rows.length === 0 &&
      metadataLockRows.length === 0 &&
      latestDeadlock === undefined
    ) {
      return {
        tool: "diagnose_lock_contention",
        status: "inconclusive",
        severity: "info",
        summary: withDatasourceSummary(
          "No matching InnoDB lock waits were observed for lock-contention diagnosis",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "lock_contention_no_matching_waits",
            title: "No matching live lock waits observed",
            confidence: "low",
            rationale:
              "The current InnoDB lock-wait snapshot did not contain rows matching the requested table or blocker-session filters.",
          },
        ],
        keyFindings: [
          input.table
            ? `No current lock waits matched table ${ctx.database ? `${ctx.database}.` : ""}${input.table}.`
            : "No current InnoDB lock waits were returned.",
          input.blockerSessionId
            ? `No current lock waits matched blocker session ${input.blockerSessionId}.`
            : "No blocker session filter was applied.",
        ],
        suspiciousEntities:
          input.table || input.blockerSessionId
            ? {
                sessions: input.blockerSessionId
                  ? [
                      {
                        sessionId: input.blockerSessionId,
                        reason:
                          "Provided as the diagnosis focus, but no matching live lock waits were observed in the current snapshot.",
                      },
                    ]
                  : undefined,
                tables: input.table
                  ? [
                      {
                        table: input.table,
                        reason:
                          "Provided as the diagnosis focus, but no matching live lock waits were observed in the current snapshot.",
                      },
                    ]
                  : undefined,
              }
            : undefined,
        evidence: [
          {
            source: "lock_waits",
            title: "Current InnoDB lock-wait snapshot",
            summary:
              "No matching rows were returned from performance_schema.data_lock_waits for the current snapshot.",
          },
        ],
        recommendedActions: [
          "Rerun the diagnosis while the lock wait is active so the blocker and waiter chain is still visible.",
          "Inspect blocker sessions with show_processlist and widen filters if the contention spans multiple tables or users.",
        ],
        limitations: [
          "This diagnostic currently uses a point-in-time InnoDB lock-wait snapshot only.",
          "No metadata-lock or deadlock-history evidence was available for this run.",
        ],
      };
    }

    const blockerCounts = countBy(rows, (row) => row.blockingSessionId);
    const tableCounts = countBy(rows, (row) =>
      row.lockedSchema && row.lockedTable
        ? `${row.lockedSchema}.${row.lockedTable}`
        : row.lockedTable,
    );
    const longWaits = rows.filter((row) => (row.waitAgeSeconds ?? 0) >= 60);
    const tableLevelWaits = rows.filter(
      (row) =>
        row.waitingLockType === "TABLE" || row.blockingLockType === "TABLE",
    );
    const topBlocker = blockerCounts[0];
    const topTable = tableCounts[0];

    const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
    if (topBlocker && topBlocker.count >= 2) {
      rootCauseCandidates.push({
        code: "lock_contention_single_blocker_hotspot",
        title: "A single blocker session is holding up multiple waiters",
        confidence: topBlocker.count >= 3 ? "high" : "medium",
        rationale: `Blocking session ${topBlocker.key} appears in ${topBlocker.count} current lock waits.`,
      });
    }
    if (longWaits.length > 0) {
      rootCauseCandidates.push({
        code: "lock_contention_long_wait_chain",
        title: "Long lock waits indicate a stuck or slow blocker transaction",
        confidence: longWaits.length >= 2 ? "high" : "medium",
        rationale: `${longWaits.length} current lock waits have been blocked for at least 60 seconds.`,
      });
    }
    if (tableLevelWaits.length > 0) {
      rootCauseCandidates.push({
        code: "lock_contention_table_level_locking",
        title: "Table-level locking is amplifying the wait chain",
        confidence: tableLevelWaits.length >= 2 ? "medium" : "low",
        rationale:
          "At least one current wait involves a TABLE lock, which often points to broader blocking impact than a single row conflict.",
      });
    }
    if (topTable && topTable.count >= 2) {
      rootCauseCandidates.push({
        code: "lock_contention_hot_table",
        title: "Contention is concentrated on a single table",
        confidence: topTable.count >= 3 ? "high" : "medium",
        rationale: `${topTable.key} appears in ${topTable.count} current lock waits.`,
      });
    }
    if (topMetadataBlocker && topMetadataBlocker.count >= 1) {
      rootCauseCandidates.push({
        code: "lock_contention_metadata_lock_blocker",
        title: "Metadata lock waits point to a blocker session",
        confidence: topMetadataBlocker.count >= 2 ? "high" : "medium",
        rationale: `Blocking session ${topMetadataBlocker.key} appears in ${topMetadataBlocker.count} current metadata-lock waits.`,
      });
    }
    if (topMetadataTable) {
      rootCauseCandidates.push({
        code: "lock_contention_metadata_lock_hot_object",
        title: "Metadata lock contention is concentrated on one object",
        confidence: topMetadataTable.count >= 2 ? "medium" : "low",
        rationale: `${topMetadataTable.key} appears in ${topMetadataTable.count} current metadata-lock waits.`,
      });
    }
    if (latestDeadlock) {
      rootCauseCandidates.push({
        code: "lock_contention_recent_deadlock_detected",
        title: "A recent deadlock was detected by InnoDB",
        confidence: "medium",
        rationale: latestDeadlock.detectedAt
          ? `SHOW ENGINE INNODB STATUS reports a latest detected deadlock at ${latestDeadlock.detectedAt}.`
          : "SHOW ENGINE INNODB STATUS reports a recent deadlock in the latest deadlock section.",
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "lock_contention_snapshot_collected",
        title:
          "Lock waits are present but no dominant blocker pattern was isolated",
        confidence: "low",
        rationale:
          "A live lock-wait snapshot was collected, but the current wait chain does not show one dominant blocker, table, or long-wait pattern.",
      });
    }

    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const severity =
      rows.length >= 10 || longWaits.length >= 3
        ? "high"
        : rows.length >= 3 || longWaits.length >= 1
          ? "warning"
          : "info";

    const blockerDetails = rows
      .filter(
        (row, index, allRows) =>
          row.blockingSessionId !== undefined &&
          allRows.findIndex(
            (candidate) =>
              candidate.blockingSessionId === row.blockingSessionId,
          ) === index,
      )
      .slice(0, 3);
    const suspiciousSessions = blockerDetails.map((row) => ({
      sessionId: row.blockingSessionId,
      user: row.blockingUser,
      state: row.blockingState ?? row.blockingTrxState,
      reason:
        topBlocker && row.blockingSessionId === topBlocker.key
          ? `Top blocker in the current snapshot with ${topBlocker.count} waiting sessions.`
          : `Observed as a blocker in the current lock-wait snapshot${row.blockingTrxAgeSeconds !== undefined ? `; transaction age ${row.blockingTrxAgeSeconds}s` : ""}.`,
    }));
    const suspiciousTables = tableCounts.slice(0, 3).map((entry) => ({
      table: entry.key,
      reason: `Observed in ${entry.count} current lock waits.`,
    }));
    for (const row of metadataLockRows.slice(0, 2)) {
      if (
        row.blockingSessionId &&
        !suspiciousSessions.some(
          (item) => item.sessionId === row.blockingSessionId,
        )
      ) {
        suspiciousSessions.push({
          sessionId: row.blockingSessionId,
          user: row.blockingUser,
          state: row.blockingState,
          reason: `Observed as a metadata-lock blocker${row.objectSchema || row.objectName ? ` on ${(row.objectSchema ? `${row.objectSchema}.` : "") + (row.objectName ?? "unknown")}` : ""}.`,
        });
      }
    }
    for (const entry of metadataTables.slice(0, 2)) {
      if (!suspiciousTables.some((item) => item.table === entry.key)) {
        suspiciousTables.push({
          table: entry.key,
          reason: `Observed in ${entry.count} current metadata-lock waits.`,
        });
      }
    }
    for (const table of latestDeadlock?.waitingTables.slice(0, 2) ?? []) {
      if (!suspiciousTables.some((item) => item.table === table)) {
        suspiciousTables.push({
          table,
          reason:
            "Referenced in the latest deadlock section from SHOW ENGINE INNODB STATUS.",
        });
      }
    }

    const keyFindings = [
      rows.length > 0
        ? `Collected ${rows.length} current InnoDB lock waits across ${blockerCounts.length} blocker sessions.`
        : "No current InnoDB row-lock waits were captured.",
    ];
    if (topBlocker) {
      keyFindings.push(
        `Blocking session ${topBlocker.key} accounts for ${topBlocker.count} waits in the current snapshot.`,
      );
    }
    if (topTable) {
      keyFindings.push(
        `Most waits are concentrated on ${topTable.key} (${topTable.count} waits).`,
      );
    }
    if (longWaits.length > 0) {
      keyFindings.push(
        `${longWaits.length} waits have been blocked for at least 60 seconds.`,
      );
    }
    if (input.blockerSessionId) {
      keyFindings.push(
        `Diagnosis was filtered to blocker session ${input.blockerSessionId}.`,
      );
    }
    if (metadataLockRows.length > 0) {
      keyFindings.push(
        `Collected ${metadataLockRows.length} current metadata-lock waits.`,
      );
    }
    if (latestDeadlock) {
      keyFindings.push(
        latestDeadlock.detectedAt
          ? `Latest detected deadlock timestamp: ${latestDeadlock.detectedAt}.`
          : "SHOW ENGINE INNODB STATUS returned a latest detected deadlock section.",
      );
    }

    const recommendedActions = [
      "Inspect the blocker session in show_processlist with include_info=true before terminating it.",
      "Review transaction scope and commit timing in the blocking application path to reduce lock hold time.",
    ];
    if (topTable) {
      recommendedActions.push(
        `Review the access pattern and indexing on ${topTable.key} to reduce hot-row or hot-table conflicts.`,
      );
    }
    if (tableLevelWaits.length > 0) {
      recommendedActions.push(
        "Check for DDL or explicit table-lock operations because TABLE-level waits are present in the snapshot.",
      );
    }
    if (metadataLockRows.length > 0) {
      recommendedActions.push(
        "Review DDL, online schema change tooling, and long-running transactions because metadata-lock waits are present.",
      );
    }
    if (latestDeadlock) {
      recommendedActions.push(
        "Inspect the latest deadlock section in SHOW ENGINE INNODB STATUS and correlate the involved statements before changing only timeout or retry settings.",
      );
    }

    const evidence = [
      {
        source: "lock_waits",
        title: "Current InnoDB lock-wait snapshot",
        summary:
          rows.length > 0
            ? `${rows.length} waits observed across ${blockerCounts.length} blocker sessions and ${tableCounts.length} locked tables.`
            : "No InnoDB row-lock waits were visible in the current snapshot.",
      },
    ];
    if (topBlocker) {
      evidence.push({
        source: "lock_waits",
        title: "Dominant blocker session",
        summary: `Session ${topBlocker.key} is blocking ${topBlocker.count} current waits.`,
      });
    }
    if (topTable) {
      evidence.push({
        source: "lock_waits",
        title: "Hot locked table",
        summary: `${topTable.key} appears in ${topTable.count} current waits.`,
      });
    }
    if (metadataLockRows.length > 0) {
      evidence.push({
        source: "metadata_locks",
        title: "Current metadata-lock snapshot",
        summary: `Collected ${metadataLockRows.length} pending metadata locks${topMetadataTable ? `; hottest object=${topMetadataTable.key}` : ""}${topMetadataBlocker ? `, dominant blocker=${topMetadataBlocker.key}` : ""}.`,
      });
    }
    if (latestDeadlock) {
      evidence.push({
        source: "deadlock_history",
        title: "Latest detected deadlock",
        summary: latestDeadlock.summary,
      });
    }

    return {
      tool: "diagnose_lock_contention",
      status: "ok",
      severity,
      summary: withDatasourceSummary(
        `Lock-contention diagnosis collected a live InnoDB lock-wait snapshot with ${rows.length} matching waits`,
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities:
        suspiciousSessions.length > 0 || suspiciousTables.length > 0
          ? {
              sessions:
                suspiciousSessions.length > 0 ? suspiciousSessions : undefined,
              tables:
                suspiciousTables.length > 0 ? suspiciousTables : undefined,
            }
          : undefined,
      evidence,
      recommendedActions: [...new Set(recommendedActions)],
      limitations: [
        "Live lock evidence remains point-in-time; waits that finish before collection will not appear.",
        latestDeadlock
          ? "Deadlock history currently uses the latest deadlock section only and does not yet parse a longer deadlock archive."
          : "Deadlock history was not available from SHOW ENGINE INNODB STATUS in this run.",
      ],
    };
  }

  async diagnoseReplicationLag(
    input: DiagnoseReplicationLagInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const [metrics, replicationStatus] = await Promise.all([
      queryMetricsSafely(
        this.metricsSource,
        [
          "replication_delay",
          "long_trx_count",
          "write_iops",
          "write_throughput",
        ],
        input,
        ctx,
      ),
      this.executor
        .executeReadonly("SHOW REPLICA STATUS", ctx, { maxRows: 10 })
        .catch(async () =>
          this.executor
            .executeReadonly("SHOW SLAVE STATUS", ctx, { maxRows: 10 })
            .catch(() => undefined),
        ),
    ]);
    const rows = replicationStatus
      ? parseReplicationStatusRows(replicationStatus)
      : [];
    const focusedRows = input.channel
      ? rows.filter((row) => row.channelName === input.channel)
      : rows;
    const replicationDelayMetric = pickMetric(metrics, "replication_delay");
    const longTrxMetric = pickMetric(metrics, "long_trx_count");
    const writeIopsMetric = pickMetric(metrics, "write_iops");
    const writeThroughputMetric = pickMetric(metrics, "write_throughput");
    const metricEvidence = metrics.map((metric) => ({
      source: "ces_metrics",
      title: `CES ${metric.alias}`,
      summary: metricSummaryText(metric),
    }));
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];

    if (focusedRows.length === 0 && metrics.length === 0) {
      return {
        tool: "diagnose_replication_lag",
        status: "not_applicable",
        severity: "info",
        summary: withDatasourceSummary(
          "Replication-lag diagnosis did not find replica status or CES lag metrics",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "replication_lag_no_evidence",
            title: "Replication evidence unavailable",
            confidence: "low",
            rationale:
              "No replica status rows or Cloud Eye replication metrics were available for the selected datasource.",
          },
        ],
        keyFindings: [
          input.replicaId
            ? `Replica focus provided: ${input.replicaId}.`
            : "No replica identifier was provided.",
          input.channel
            ? `Replication channel provided: ${input.channel}.`
            : "No replication channel was provided.",
          "SHOW REPLICA STATUS / SHOW SLAVE STATUS did not return usable rows.",
        ],
        evidence: [
          {
            source: "replication_status",
            title: "Replica status",
            summary:
              "No rows were returned from SHOW REPLICA STATUS or SHOW SLAVE STATUS.",
          },
        ],
        recommendedActions: [
          "Run this diagnostic on a replica or read-only node with replication status access.",
          "Enable the CES metrics source to correlate replica lag with Cloud Eye lag, write IOPS, and long transaction metrics.",
        ],
        recommendedNextTools: ["show_processlist"],
        nextToolInputs: [
          buildShowProcesslistNextToolInput(
            {
              includeIdle: false,
              includeInfo: true,
            },
            input,
            "Inspect live sessions on the replica or selected datasource to confirm whether replay is blocked by long-running or idle-in-transaction work.",
          ),
        ],
        limitations: [
          ...metricsSourceLimitation(this.metricsSource),
          "The selected account may not have access to replication status commands.",
        ],
      };
    }

    const lagSecondsFromStatus = focusedRows
      .map((row) => row.secondsBehindSource)
      .filter((value): value is number => value !== undefined);
    const maxStatusLag =
      lagSecondsFromStatus.length > 0
        ? Math.max(...lagSecondsFromStatus)
        : undefined;
    const maxCesLag = replicationDelayMetric?.max;
    const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
    const stoppedRows = focusedRows.filter(
      (row) =>
        row.replicaIoRunning?.toLowerCase() === "no" ||
        row.replicaSqlRunning?.toLowerCase() === "no" ||
        row.lastIoError ||
        row.lastSqlError,
    );
    if (stoppedRows.length > 0) {
      rootCauseCandidates.push({
        code: "replication_lag_applier_or_io_thread_stopped",
        title: "Replica IO or SQL applier is stopped or reporting errors",
        confidence: "high",
        rationale: `Replica status returned ${stoppedRows.length} rows with stopped threads or IO/SQL errors.`,
      });
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildShowProcesslistNextToolInput(
          {
            includeIdle: false,
            includeInfo: true,
          },
          input,
          "Inspect live sessions and statement text before restarting replica IO/SQL components.",
        ),
      );
    }
    if ((maxCesLag ?? 0) >= 60 || (maxStatusLag ?? 0) >= 60) {
      rootCauseCandidates.push({
        code: "replication_lag_delay_confirmed",
        title: "Replication delay is elevated",
        confidence: (maxCesLag ?? maxStatusLag ?? 0) >= 300 ? "high" : "medium",
        rationale: `Replication lag exceeded the current threshold${maxCesLag !== undefined ? `; max_ces_lag=${roundMetric(maxCesLag)}` : ""}${maxStatusLag !== undefined ? `, max_status_lag=${roundMetric(maxStatusLag)}` : ""}.`,
      });
      recommendedNextTools.add("diagnose_db_hotspot");
      nextToolInputs.push(
        buildDbHotspotNextToolInput(
          { scope: "session" },
          input,
          "Correlate elevated replication delay with the hottest sessions on the datasource during the same window.",
        ),
      );
    }
    if (longTrxMetric && (longTrxMetric.max ?? 0) > 0) {
      rootCauseCandidates.push({
        code: "replication_lag_long_transaction_pressure",
        title: "Long transactions may delay replica replay",
        confidence: (longTrxMetric?.max ?? 0) >= 3 ? "medium" : "low",
        rationale: `CES long transaction count was non-zero; ${metricSummaryText(longTrxMetric)}.`,
      });
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildShowProcesslistNextToolInput(
          {
            includeIdle: false,
            includeInfo: true,
          },
          input,
          "Inspect long-running sessions because open transactions can delay replica replay.",
        ),
      );
    }
    if (
      (writeIopsMetric?.max ?? 0) >= 1000 ||
      (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024
    ) {
      rootCauseCandidates.push({
        code: "replication_lag_write_pressure",
        title: "Primary-side write pressure may be outpacing replay",
        confidence: "medium",
        rationale: `CES write workload metrics are elevated${writeIopsMetric?.max !== undefined ? `; max_write_iops=${roundMetric(writeIopsMetric.max)}` : ""}${writeThroughputMetric?.max !== undefined ? `, max_write_throughput=${roundMetric(writeThroughputMetric.max)}` : ""}.`,
      });
      recommendedNextTools.add("find_top_slow_sql");
      nextToolInputs.push(
        buildFindTopSlowSqlNextToolInput(
          { sortBy: "total_latency", topN: 5 },
          input,
          "Rank the heaviest SQL workload during the lag window to see whether primary-side write pressure is dominating replay.",
        ),
      );
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "replication_lag_evidence_collected",
        title:
          "Replication evidence was collected without a dominant lag signal",
        confidence: "low",
        rationale:
          "Replica status or CES replication metrics were collected, but lag/error thresholds were not crossed.",
      });
    }

    const keyFindings = [
      input.replicaId
        ? `Replica focus provided: ${input.replicaId}.`
        : "No replica identifier was provided.",
      input.channel
        ? `Replication channel provided: ${input.channel}.`
        : "No replication channel was provided.",
      focusedRows.length > 0
        ? `Collected ${focusedRows.length} replication status rows.`
        : "No replication status rows were available.",
      replicationDelayMetric
        ? `CES replication delay: ${metricSummaryText(replicationDelayMetric)}.`
        : "CES replication delay metric was not returned.",
    ];
    if (longTrxMetric) {
      keyFindings.push(
        `CES long transaction count: ${metricSummaryText(longTrxMetric)}.`,
      );
    }
    if (writeIopsMetric) {
      keyFindings.push(
        `CES write IOPS: ${metricSummaryText(writeIopsMetric)}.`,
      );
    }

    const evidence = [
      {
        source: "replication_status",
        title: "Replica status",
        summary:
          focusedRows.length > 0
            ? `Collected ${focusedRows.length} rows; max_status_lag=${maxStatusLag ?? "n/a"} seconds, stopped_or_error_rows=${stoppedRows.length}.`
            : "No rows were returned from SHOW REPLICA STATUS or SHOW SLAVE STATUS.",
      },
      ...metricEvidence,
    ];

    return {
      tool: "diagnose_replication_lag",
      status:
        focusedRows.length > 0 || metrics.length > 0
          ? rootCauseCandidates[0]?.code ===
            "replication_lag_evidence_collected"
            ? "inconclusive"
            : "ok"
          : "not_applicable",
      severity:
        stoppedRows.length > 0 || (maxCesLag ?? maxStatusLag ?? 0) >= 300
          ? "high"
          : (maxCesLag ?? maxStatusLag ?? 0) >= 60
            ? "warning"
            : "info",
      summary: withDatasourceSummary(
        rootCauseCandidates[0]?.code === "replication_lag_evidence_collected"
          ? "Replication-lag diagnosis collected evidence without isolating a dominant lag signal"
          : "Replication-lag diagnosis collected replica and control-plane evidence",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(
        0,
        clampInteger(input.maxCandidates, 3, 1, 10),
      ),
      keyFindings,
      evidence,
      recommendedActions: [
        "Check replica IO/SQL thread state and recent SQL/IO errors before restarting replication components.",
        "Correlate replica lag with primary write spikes, long transactions, and DDL or bulk-load activity.",
        "If CES lag is high but SHOW REPLICA STATUS is unavailable, validate the command on the read-only node or use cloud console replica diagnostics.",
      ],
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(0, 5),
      limitations: [
        ...metricsSourceLimitation(this.metricsSource),
        "Replica status command availability depends on TaurusDB topology and account privileges.",
      ],
    };
  }

  async diagnoseStoragePressure(
    input: DiagnoseStoragePressureInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const maxCandidates = clampInteger(input.maxCandidates, 5, 1, 10);
    const [digestRows, tableRows, metrics] = await Promise.all([
      this.findStorageStatementDigests(input, ctx).catch(
        () => [] as StatementDigestRow[],
      ),
      this.findTableStorageStats(input, ctx).catch(
        () => [] as TableStorageRow[],
      ),
      queryMetricsSafely(
        this.metricsSource,
        [
          "storage_used_size",
          "storage_write_delay",
          "storage_read_delay",
          "write_iops",
          "read_iops",
          "write_throughput",
          "read_throughput",
          "temp_tables_per_min",
        ],
        input,
        ctx,
      ),
    ]);
    const storageUsedMetric = pickMetric(metrics, "storage_used_size");
    const writeDelayMetric = pickMetric(metrics, "storage_write_delay");
    const readDelayMetric = pickMetric(metrics, "storage_read_delay");
    const writeIopsMetric = pickMetric(metrics, "write_iops");
    const readIopsMetric = pickMetric(metrics, "read_iops");
    const writeThroughputMetric = pickMetric(metrics, "write_throughput");
    const readThroughputMetric = pickMetric(metrics, "read_throughput");
    const tempTablesMetric = pickMetric(metrics, "temp_tables_per_min");
    const metricEvidence = metrics.map((metric) => ({
      source: "ces_metrics",
      title: `CES ${metric.alias}`,
      summary: metricSummaryText(metric),
    }));
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];

    const focusedTableName = input.table?.includes(".")
      ? input.table.split(".").slice(1).join(".")
      : input.table;
    const relevantDigests = digestRows.filter((row) => {
      if (!focusedTableName) {
        return true;
      }
      const target = focusedTableName.toUpperCase();
      return (
        row.digestText?.toUpperCase().includes(target) ||
        row.querySampleText?.toUpperCase().includes(target)
      );
    });
    const tmpDiskDigests = relevantDigests.filter(
      (row) => (row.avgTmpDiskTables ?? 0) > 0,
    );
    const tmpTableDigests = relevantDigests.filter(
      (row) => (row.avgTmpTables ?? 0) > 0,
    );
    const scanDigests = relevantDigests.filter(
      (row) =>
        (row.noIndexUsedCount ?? 0) > 0 ||
        (row.selectScanCount ?? 0) > 0 ||
        (row.avgRowsExamined ?? 0) >= 10_000,
    );
    const sortDigests = relevantDigests.filter(
      (row) => (row.avgSortRows ?? 0) >= 1_000,
    );
    const largeTables = tableRows.filter(
      (row) =>
        (row.totalMb ?? 0) >= 1024 ||
        (row.rowCountEstimate ?? 0) >= 1_000_000 ||
        (row.dataFreeMb ?? 0) >= 1024,
    );

    const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
    if (tmpDiskDigests.length > 0) {
      const lead = tmpDiskDigests[0];
      rootCauseCandidates.push({
        code: "storage_pressure_tmp_disk_spill",
        title: "SQL workload is spilling temporary tables to disk",
        confidence: (lead.avgTmpDiskTables ?? 0) >= 1 ? "high" : "medium",
        rationale: `Digest summaries show temporary disk table usage${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgTmpDiskTables !== undefined ? `; avg_tmp_disk_tables=${lead.avgTmpDiskTables}` : ""}.`,
      });
    }
    if (scanDigests.length > 0) {
      const lead = scanDigests[0];
      rootCauseCandidates.push({
        code: "storage_pressure_scan_heavy_sql",
        title: "Scan-heavy SQL is driving storage pressure",
        confidence:
          (lead.noIndexUsedCount ?? 0) > 0 ||
          (lead.avgRowsExamined ?? 0) >= 100_000
            ? "high"
            : "medium",
        rationale: `Digest summaries show scan-heavy execution${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgRowsExamined !== undefined ? `; avg_rows_examined=${lead.avgRowsExamined}` : ""}${lead.noIndexUsedCount !== undefined ? `, no_index_used_count=${lead.noIndexUsedCount}` : ""}${lead.selectScanCount !== undefined ? `, select_scan_count=${lead.selectScanCount}` : ""}.`,
      });
    }
    if (sortDigests.length > 0 || tmpTableDigests.length > 0) {
      const lead = sortDigests[0] ?? tmpTableDigests[0];
      rootCauseCandidates.push({
        code: "storage_pressure_sort_or_tmp_table_workload",
        title: "Sort or temporary-table workload is increasing storage work",
        confidence:
          (lead.avgSortRows ?? 0) >= 10_000 || (lead.avgTmpTables ?? 0) >= 1
            ? "medium"
            : "low",
        rationale: `Digest summaries show sort or temporary-table work${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgSortRows !== undefined ? `; avg_sort_rows=${lead.avgSortRows}` : ""}${lead.avgTmpTables !== undefined ? `, avg_tmp_tables=${lead.avgTmpTables}` : ""}.`,
      });
    }
    if (largeTables.length > 0) {
      const lead = largeTables[0];
      const qualifiedTable = [lead.schemaName, lead.tableName]
        .filter(Boolean)
        .join(".");
      rootCauseCandidates.push({
        code: "storage_pressure_large_or_fragmented_table",
        title: "Large or fragmented table may amplify storage work",
        confidence: "medium",
        rationale: `${qualifiedTable || "A table"} is among the largest local tables${lead.totalMb !== undefined ? `; total_mb=${lead.totalMb}` : ""}${lead.rowCountEstimate !== undefined ? `, row_count_estimate=${lead.rowCountEstimate}` : ""}${lead.dataFreeMb !== undefined ? `, data_free_mb=${lead.dataFreeMb}` : ""}.`,
      });
    }
    if (
      (writeDelayMetric?.max ?? 0) >= 50 ||
      (readDelayMetric?.max ?? 0) >= 50
    ) {
      rootCauseCandidates.push({
        code: "storage_pressure_ces_io_latency",
        title: "Cloud Eye shows elevated storage read/write latency",
        confidence:
          (writeDelayMetric?.max ?? 0) >= 100 ||
          (readDelayMetric?.max ?? 0) >= 100
            ? "high"
            : "medium",
        rationale: `CES storage latency crossed the current thresholds${writeDelayMetric?.max !== undefined ? `; max_write_delay=${roundMetric(writeDelayMetric.max)}` : ""}${readDelayMetric?.max !== undefined ? `, max_read_delay=${roundMetric(readDelayMetric.max)}` : ""}.`,
      });
    }
    if (
      (writeIopsMetric?.max ?? 0) >= 1000 ||
      (readIopsMetric?.max ?? 0) >= 1000 ||
      (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024 ||
      (readThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024
    ) {
      rootCauseCandidates.push({
        code: "storage_pressure_ces_io_throughput",
        title: "Cloud Eye shows elevated IOPS or throughput",
        confidence: "medium",
        rationale: `CES I/O workload metrics are elevated${writeIopsMetric?.max !== undefined ? `; max_write_iops=${roundMetric(writeIopsMetric.max)}` : ""}${readIopsMetric?.max !== undefined ? `, max_read_iops=${roundMetric(readIopsMetric.max)}` : ""}${writeThroughputMetric?.max !== undefined ? `, max_write_throughput=${roundMetric(writeThroughputMetric.max)}` : ""}${readThroughputMetric?.max !== undefined ? `, max_read_throughput=${roundMetric(readThroughputMetric.max)}` : ""}.`,
      });
    }
    if (
      tempTablesMetric &&
      (tempTablesMetric.max ?? 0) > 0 &&
      tmpDiskDigests.length > 0
    ) {
      rootCauseCandidates.push({
        code: "storage_pressure_tmp_table_metric_confirmed",
        title: "Temporary table workload is visible in SQL and CES metrics",
        confidence: "medium",
        rationale: `Statement digests show temporary disk usage and CES temp-table metrics were non-zero; ${metricSummaryText(tempTablesMetric)}.`,
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "storage_pressure_snapshot_collected",
        title:
          "Storage evidence was collected but no dominant pressure signal stood out",
        confidence: "low",
        rationale:
          "Local table size and statement digest summaries were collected, but temporary disk spill, scan pressure, and large-table thresholds were not crossed.",
      });
    }

    const leadDigest = relevantDigests[0];
    const suspiciousSqls = relevantDigests
      .filter(
        (row) =>
          (row.avgTmpDiskTables ?? 0) > 0 ||
          (row.avgTmpTables ?? 0) > 0 ||
          (row.avgSortRows ?? 0) >= 1_000 ||
          (row.noIndexUsedCount ?? 0) > 0 ||
          (row.selectScanCount ?? 0) > 0 ||
          (row.avgRowsExamined ?? 0) >= 10_000,
      )
      .slice(0, maxCandidates)
      .map((row) => ({
        sqlHash: row.querySampleText
          ? sqlHash(normalizeSql(row.querySampleText))
          : undefined,
        digestText: row.digestText,
        reason: `Statement digest shows storage-relevant work${row.avgTmpDiskTables !== undefined ? `; avg_tmp_disk_tables=${row.avgTmpDiskTables}` : ""}${row.avgTmpTables !== undefined ? `, avg_tmp_tables=${row.avgTmpTables}` : ""}${row.avgSortRows !== undefined ? `, avg_sort_rows=${row.avgSortRows}` : ""}${row.avgRowsExamined !== undefined ? `, avg_rows_examined=${row.avgRowsExamined}` : ""}.`,
      }));
    const suspiciousTables = tableRows.slice(0, maxCandidates).map((row) => {
      const qualifiedTable = [row.schemaName, row.tableName]
        .filter(Boolean)
        .join(".");
      return {
        table: qualifiedTable || row.tableName || input.table || "unknown",
        reason: input.table
          ? "Provided as the storage-pressure focus and matched against local table-size metadata."
          : `Top local table by storage footprint${row.totalMb !== undefined ? `; total_mb=${row.totalMb}` : ""}${row.rowCountEstimate !== undefined ? `, row_count_estimate=${row.rowCountEstimate}` : ""}.`,
      };
    });

    const keyFindings = [
      `Scope requested: ${input.scope ?? "instance"}.`,
      input.table
        ? `Table focus provided: ${input.table}.`
        : "No table focus was provided.",
      relevantDigests.length > 0
        ? `Collected ${relevantDigests.length} statement digest rows for storage-pressure correlation.`
        : "No statement digest rows were available for storage-pressure correlation.",
      tableRows.length > 0
        ? `Collected ${tableRows.length} table-size rows from information_schema.TABLES.`
        : "No table-size rows were available from information_schema.TABLES.",
    ];
    if (tmpDiskDigests.length > 0) {
      keyFindings.push(
        `${tmpDiskDigests.length} digest rows show temporary disk table usage.`,
      );
    }
    if (scanDigests.length > 0) {
      keyFindings.push(
        `${scanDigests.length} digest rows show scan-heavy execution.`,
      );
    }
    if (leadDigest?.digestText) {
      keyFindings.push(
        `Lead storage-relevant digest: ${leadDigest.digestText}.`,
      );
    }
    if (storageUsedMetric) {
      keyFindings.push(
        `CES storage used size: ${metricSummaryText(storageUsedMetric)}.`,
      );
    }
    if (writeDelayMetric) {
      keyFindings.push(
        `CES storage write delay: ${metricSummaryText(writeDelayMetric)}.`,
      );
    }
    if (readDelayMetric) {
      keyFindings.push(
        `CES storage read delay: ${metricSummaryText(readDelayMetric)}.`,
      );
    }
    if (writeIopsMetric || readIopsMetric) {
      keyFindings.push(
        `CES IOPS: write=${writeIopsMetric ? metricSummaryText(writeIopsMetric) : "n/a"}; read=${readIopsMetric ? metricSummaryText(readIopsMetric) : "n/a"}.`,
      );
    }

    const leadSlowQueryInput = buildSlowQueryNextToolInput(
      {
        sqlHash: leadDigest?.querySampleText
          ? sqlHash(normalizeSql(leadDigest.querySampleText))
          : undefined,
        digestText: leadDigest?.digestText,
        sampleSql: leadDigest?.querySampleText,
      },
      input,
      "Inspect the lead storage-relevant digest with plan and runtime counters before tuning only table footprint or instance-level storage settings.",
    );
    if (leadSlowQueryInput) {
      recommendedNextTools.add("diagnose_slow_query");
      nextToolInputs.push(leadSlowQueryInput);
    }
    if (
      relevantDigests.length > 1 ||
      ((writeDelayMetric?.max ?? 0) >= 50 ||
        (readDelayMetric?.max ?? 0) >= 50 ||
        (writeIopsMetric?.max ?? 0) >= 1000 ||
        (readIopsMetric?.max ?? 0) >= 1000 ||
        (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024 ||
        (readThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024)
    ) {
      recommendedNextTools.add("find_top_slow_sql");
      nextToolInputs.push(
        buildFindTopSlowSqlNextToolInput(
          { sortBy: "total_latency", topN: 5 },
          input,
          "Rank the broader slow-SQL set to confirm whether the lead digest is representative of overall storage pressure.",
        ),
      );
    }
    if (input.scope === "table" || input.table || largeTables.length > 0) {
      recommendedNextTools.add("diagnose_db_hotspot");
      nextToolInputs.push(
        buildDbHotspotNextToolInput(
          { scope: "table" },
          input,
          "Correlate the suspected table footprint with current table-level hotspots before changing only storage capacity or purge policy.",
        ),
      );
    }

    const recommendedActions = [
      "Use diagnose_slow_query on the lead storage-relevant SQL digest to inspect plan shape and runtime counters.",
      "Review predicates, indexes, ORDER BY, and GROUP BY clauses for digests with scan, filesort, or temporary-table signals.",
    ];
    if (tmpDiskDigests.length > 0) {
      recommendedActions.push(
        "Reduce temporary disk tables by supporting grouping/sorting with indexes or reducing intermediate row width.",
      );
    }
    if (largeTables.length > 0) {
      recommendedActions.push(
        "Review the largest table footprints and purge/archive strategy before tuning only individual SQL statements.",
      );
    }
    if (
      (writeDelayMetric?.max ?? 0) >= 50 ||
      (readDelayMetric?.max ?? 0) >= 50
    ) {
      recommendedActions.push(
        "Correlate SQL spill/scan candidates with CES storage read/write latency before changing only query plans.",
      );
    }

    const severity: DiagnosticSeverity =
      (writeDelayMetric?.max ?? 0) >= 100 ||
      (readDelayMetric?.max ?? 0) >= 100 ||
      tmpDiskDigests.length > 0 ||
      scanDigests.some((row) => (row.avgRowsExamined ?? 0) >= 100_000)
        ? "warning"
        : rootCauseCandidates[0]?.code === "storage_pressure_snapshot_collected"
          ? "info"
          : "warning";

    return {
      tool: "diagnose_storage_pressure",
      status:
        relevantDigests.length > 0 || tableRows.length > 0 || metrics.length > 0
          ? "ok"
          : "inconclusive",
      severity,
      summary: withDatasourceSummary(
        rootCauseCandidates[0]?.code === "storage_pressure_snapshot_collected"
          ? "Storage-pressure diagnosis collected local evidence without isolating a dominant pressure signal"
          : "Storage-pressure diagnosis collected local SQL and table metadata evidence",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities:
        suspiciousSqls.length > 0 || suspiciousTables.length > 0
          ? {
              sqls: suspiciousSqls.length > 0 ? suspiciousSqls : undefined,
              tables:
                suspiciousTables.length > 0 ? suspiciousTables : undefined,
            }
          : undefined,
      evidence: [
        {
          source: "statement_digest",
          title: "Statement digest storage counters",
          summary:
            relevantDigests.length > 0
              ? `Collected ${relevantDigests.length} digest rows; tmp_disk=${tmpDiskDigests.length}, scan_heavy=${scanDigests.length}, sort_or_tmp=${Math.max(sortDigests.length, tmpTableDigests.length)}.`
              : "No matching rows were returned from performance_schema.events_statements_summary_by_digest.",
        },
        {
          source: "table_storage",
          title: "Table storage footprint",
          summary:
            tableRows.length > 0
              ? `Collected ${tableRows.length} rows from information_schema.TABLES; largest=${[tableRows[0]?.schemaName, tableRows[0]?.tableName].filter(Boolean).join(".") || "n/a"}${tableRows[0]?.totalMb !== undefined ? ` (${tableRows[0].totalMb} MB)` : ""}.`
              : "No matching table-size rows were returned from information_schema.TABLES.",
        },
        ...metricEvidence,
      ],
      recommendedActions: [...new Set(recommendedActions)],
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(0, 5),
      limitations: [
        ...metricsSourceLimitation(this.metricsSource),
        "Statement digest counters are cumulative within performance_schema retention and are not yet filtered by the requested time_range.",
      ],
    };
  }

  async explain(sql: string, ctx: SessionContext): Promise<ExplainResult> {
    return this.executor.explain(sql, ctx);
  }

  async explainEnhanced(
    sql: string,
    ctx: SessionContext,
  ): Promise<EnhancedExplainResult> {
    const [standardPlan, features] = await Promise.all([
      this.executor.explain(sql, ctx),
      this.capabilityProbe.listFeatures(ctx),
    ]);
    const extras = explainExtras(standardPlan.plan).join(" ");
    const fullScanLikely = standardPlan.riskSummary.fullTableScanLikely;
    const hasOffset = hasSqlPattern(sql, /\boffset\s+\d+/i);

    return {
      standardPlan,
      taurusHints: {
        ndpPushdown: {
          condition: /using pushed ndp condition/i.test(extras),
          columns: /using pushed ndp columns/i.test(extras),
          aggregate: /using pushed ndp aggregate/i.test(extras),
          blockedReason: !features.ndp_pushdown.available
            ? features.ndp_pushdown.reason
            : features.ndp_pushdown.enabled === false
              ? "ndp_pushdown is available but not enabled."
              : undefined,
        },
        parallelQuery: {
          wouldEnable:
            features.parallel_query.available &&
            (fullScanLikely ||
              hasSqlPattern(sql, /\b(group\s+by|order\s+by|join)\b/i) ||
              (standardPlan.riskSummary.estimatedRows ?? 0) >= 100_000),
          estimatedDegree:
            features.parallel_query.available && features.parallel_query.enabled
              ? ctx.limits.maxRows >= 1000
                ? 4
                : 2
              : undefined,
          blockedReason: !features.parallel_query.available
            ? features.parallel_query.reason
            : features.parallel_query.enabled === false
              ? "parallel_query is available but force_parallel_execute is disabled."
              : undefined,
        },
        offsetPushdown:
          hasOffset &&
          features.offset_pushdown.available &&
          features.offset_pushdown.enabled !== false,
      },
      optimizationSuggestions: buildEnhancedExplainSuggestions(
        sql,
        features,
        standardPlan,
      ),
    };
  }

  async executeReadonly(
    sql: string,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    return this.executor.executeReadonly(sql, ctx, opts);
  }

  async executeMutation(
    sql: string,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult> {
    return this.executor.executeMutation(sql, ctx, opts);
  }

  async flashbackQuery(
    input: FlashbackInput,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    const features = await this.capabilityProbe.listFeatures(ctx);
    const flashbackFeature = features.flashback_query;
    if (!flashbackFeature.available || flashbackFeature.enabled === false) {
      throw new UnsupportedFeatureError(
        "flashback_query",
        flashbackFeature.reason ??
          `Flashback query requires kernel version >= ${flashbackFeature.minVersion ?? "unknown"}.`,
        {
          requiredVersion: flashbackFeature.minVersion,
          currentVersion: (await this.capabilityProbe.getKernelInfo(ctx))
            .kernelVersion,
        },
      );
    }

    const database = input.database ?? ctx.database;
    if (!database) {
      throw new Error(
        "Flashback query requires a database context. Provide input.database or configure a default database.",
      );
    }

    const sql = buildFlashbackSql(input, database);
    return this.executor.executeReadonly(sql, ctx, {
      ...flashbackReadonlyOptions(input.limit),
      ...opts,
    });
  }

  async getQueryStatus(queryId: string): Promise<QueryStatus> {
    return this.executor.getQueryStatus(queryId);
  }

  async cancelQuery(queryId: string): Promise<CancelResult> {
    return this.executor.cancelQuery(queryId);
  }

  async issueConfirmation(
    input: IssueConfirmationInput,
  ): Promise<ConfirmationToken> {
    const resolved = resolveConfirmationSql(input);
    return this.confirmationStore.issue({
      sqlHash: resolved.hash,
      normalizedSql: resolved.normalized,
      context: input.context,
      riskLevel: input.riskLevel,
      ttlSeconds: input.ttlSeconds,
    });
  }

  async validateConfirmation(
    token: string,
    sql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult> {
    return this.confirmationStore.validate(token, sql, ctx);
  }

  async handleConfirmation(
    decision: GuardrailDecision,
    ctx: SessionContext,
  ): Promise<ConfirmationOutcome> {
    if (!decision.requiresConfirmation) {
      return { status: "confirmed" };
    }

    const token = await this.confirmationStore.issue({
      sqlHash: decision.sqlHash,
      normalizedSql: decision.normalizedSql,
      context: ctx,
      riskLevel: decision.riskLevel,
    });

    return {
      status: "token_issued",
      token: token.token,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    };
  }

  async close(): Promise<void> {
    await this.connectionPool.close();
    if (this.confirmationStore instanceof InMemoryConfirmationStore) {
      this.confirmationStore.stop();
    }
  }
}
