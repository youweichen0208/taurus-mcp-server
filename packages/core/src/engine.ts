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
import type { CapabilitySnapshot, FeatureMatrix, KernelInfo } from "./capability/types.js";
import { getConfig, type Config } from "./config/index.js";
import {
  createDatasourceResolver,
} from "./context/datasource-resolver.js";
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
  type DiagnoseConnectionSpikeInput,
  type DiagnoseLockContentionInput,
  type DiagnoseReplicationLagInput,
  type DiagnoseSlowQueryInput,
  type DiagnoseStoragePressureInput,
  type DiagnosticRootCauseCandidate,
  type DiagnosticResult,
} from "./diagnostics/types.js";
import {
  buildResolveSlowSqlInput,
  createSlowSqlSource,
  type ExternalSlowSqlSample,
  type SlowSqlSource,
} from "./diagnostics/slow-sql-source.js";
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
  | { status: "token_issued"; token: string; issuedAt: number; expiresAt: number };

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

type StatementDigestRow = {
  schemaName?: string;
  digest?: string;
  digestText?: string;
  querySampleText?: string;
  execCount?: number;
  avgLatencyMs?: number;
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
        typeof mapped.info_preview === "string" ? mapped.info_preview : undefined,
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
        typeof mapped.waiting_user === "string" ? mapped.waiting_user : undefined,
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
        typeof mapped.locked_schema === "string" ? mapped.locked_schema : undefined,
      lockedTable:
        typeof mapped.locked_table === "string" ? mapped.locked_table : undefined,
      lockedIndex:
        typeof mapped.locked_index === "string" ? mapped.locked_index : undefined,
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
        typeof mapped.waiting_query === "string" ? mapped.waiting_query : undefined,
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

function parseStatementWaitEventRows(result: QueryResult): StatementWaitEventRow[] {
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
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function evidenceRowLimit(level: DiagnoseConnectionSpikeInput["evidenceLevel"]): number {
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
}

function toDataSourceInfo(profile: DataSourceProfile, defaultDatasource: string | undefined): DataSourceInfo {
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

function resolveConfirmationSql(input: IssueConfirmationInput): { normalized: string; hash: string } {
  const normalized = input.normalizedSql ?? (input.sql ? normalizeSql(input.sql) : undefined);
  const hash = input.sqlHash ?? (normalized ? sqlHash(normalized) : undefined);

  if (!normalized || !hash) {
    throw new Error("Issue confirmation requires sql, normalizedSql, or sqlHash context.");
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
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
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
    suggestions.push("parallel_query is available but disabled. Consider SET GLOBAL force_parallel_execute=ON.");
  }

  if (!features.flashback_query.available) {
    suggestions.push("flashback_query is unavailable; high-risk mutations have weaker recovery options.");
  }

  if (features.offset_pushdown.available && features.offset_pushdown.enabled !== false) {
    if (hasSqlPattern(sql, /\boffset\s+\d+/i)) {
      suggestions.push("OFFSET detected. TaurusDB offset_pushdown may help reduce coordinator overhead.");
    }
  }

  if (explainResult.riskSummary.fullTableScanLikely && features.ndp_pushdown.available) {
    suggestions.push("Full table scan is likely. Review whether NDP pushdown can reduce scanned rows.");
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
  }

  static async create(options: TaurusDBEngineCreateOptions = {}): Promise<TaurusDBEngine> {
    const config = options.config ?? getConfig();
    const profileLoader = options.profileLoader ?? createSqlProfileLoader({ config });
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
    const guardrail =
      options.guardrail ??
      createGuardrail();
    const confirmationStore = options.confirmationStore ?? createConfirmationStore();
    const capabilityProbe =
      options.capabilityProbe ??
      createCapabilityProbe({
        connectionPool,
      });
    const slowSqlSource = options.slowSqlSource ?? createSlowSqlSource(config);

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

  async resolveContext(input: DatasourceResolveInput, taskId: string): Promise<SessionContext> {
    return this.datasourceResolver.resolve(input, taskId);
  }

  async listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]> {
    return this.schemaIntrospector.listDatabases(ctx);
  }

  async listTables(ctx: SessionContext, database: string): Promise<TableInfo[]> {
    return this.schemaIntrospector.listTables(ctx, database);
  }

  async describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema> {
    return this.schemaIntrospector.describeTable(ctx, database, table);
  }

  async inspectSql(input: InspectInput): Promise<GuardrailDecision> {
    return this.guardrail.inspect(input);
  }

  async probeCapabilities(
    ctx: SessionContext,
  ): Promise<CapabilitySnapshot> {
    return this.capabilityProbe.probe(ctx);
  }

  async getKernelInfo(
    ctx: SessionContext,
  ): Promise<KernelInfo> {
    return this.capabilityProbe.getKernelInfo(ctx);
  }

  async listFeatures(
    ctx: SessionContext,
  ): Promise<FeatureMatrix> {
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
      maxColumns: 14,
      maxFieldChars: 2048,
      timeoutMs: ctx.limits.timeoutMs,
    });
    return parseStatementDigestRows(result)[0];
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

  async diagnoseSlowQuery(
    input: DiagnoseSlowQueryInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const externalSlowSqlSample =
      !input.sql && this.slowSqlSource
        ? await this.slowSqlSource.resolve(buildResolveSlowSqlInput(input), ctx)
        : undefined;
    const digestSample =
      !input.sql && input.digestText
        ? await this.findStatementDigestSample(input.digestText, ctx)
        : undefined;
    const waitEventRows =
      input.digestText || digestSample?.digestText
        ? await this.findStatementWaitEvents(
            input.digestText ?? digestSample?.digestText ?? "",
            ctx,
          )
        : [];
    const effectiveSql =
      input.sql ??
      externalSlowSqlSample?.sql ??
      digestSample?.querySampleText;
    const derivedSqlHash = effectiveSql ? sqlHash(normalizeSql(effectiveSql)) : undefined;
    const runtimeLockTimeMs =
      digestSample?.avgLockTimeMs ?? externalSlowSqlSample?.avgLockTimeMs;
    const runtimeRowsExamined =
      digestSample?.avgRowsExamined ?? externalSlowSqlSample?.avgRowsExamined;
    const suspiciousSql =
      effectiveSql || input.sqlHash || input.digestText
        ? [
            {
              sqlHash: input.sqlHash ?? derivedSqlHash,
              digestText: input.digestText,
              reason: input.sql
                ? "SQL text was provided and analyzed with EXPLAIN evidence."
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
          extractPlanTableNames(standardPlan.plan).slice(0, 3).map(async (table) => {
            try {
              const schema = await this.describeTable(ctx, ctx.database!, table);
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
        rationale:
          `EXPLAIN indicates a likely full table scan${riskSummary.estimatedRows !== undefined ? ` across about ${riskSummary.estimatedRows} rows` : ""}.`,
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
        confidence: (digestSample?.avgTmpDiskTables ?? 0) >= 1 ? "medium" : "low",
        rationale:
          `Digest summaries show about ${digestSample?.avgTmpDiskTables} temporary disk tables per execution, which suggests spill-heavy grouping or sorting.`,
      });
    }
    if ((runtimeLockTimeMs ?? 0) >= 10) {
      rootCauseCandidates.push({
        code: "slow_query_lock_wait_pressure",
        title: "Lock wait time is a material part of the statement latency",
        confidence: (runtimeLockTimeMs ?? 0) >= 100 ? "high" : "medium",
        rationale:
          `${digestSample?.avgLockTimeMs !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeLockTimeMs} ms of lock time per execution, which suggests blocking or lock-wait pressure on the statement path.`,
      });
    }
    const topWaitEvent = waitEventRows[0];
    if (topWaitEvent?.eventName?.startsWith("wait/lock/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_lock_contention",
        title: "Runtime wait events point to lock contention",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "high" : "medium",
        rationale:
          `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event${topWaitEvent.totalWaitMs !== undefined ? ` with about ${topWaitEvent.totalWaitMs} ms total wait time` : ""}.`,
      });
    } else if (topWaitEvent?.eventName?.startsWith("wait/io/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_io_pressure",
        title: "Runtime wait events point to I/O-bound execution",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
        rationale:
          `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which usually indicates file or handler I/O pressure.`,
      });
    } else if (topWaitEvent?.eventName?.startsWith("wait/synch/")) {
      rootCauseCandidates.push({
        code: "slow_query_wait_event_sync_contention",
        title: "Runtime wait events point to synchronization contention",
        confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
        rationale:
          `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which suggests mutex or rwlock contention in the execution path.`,
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
        rationale:
          `Digest summaries recorded${(digestSample?.selectScanCount ?? 0) > 0 ? ` ${digestSample?.selectScanCount} scan-driven executions` : ""}${(digestSample?.selectScanCount ?? 0) > 0 && (digestSample?.noIndexUsedCount ?? 0) > 0 ? " and" : ""}${(digestSample?.noIndexUsedCount ?? 0) > 0 ? ` ${digestSample?.noIndexUsedCount} executions without index usage` : ""}.`,
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "slow_query_plan_collected",
        title: "Plan evidence was collected but no single dominant cause stood out",
        confidence: "low",
        rationale:
          "Live EXPLAIN evidence was collected, but the current heuristics did not isolate a single dominant full-scan, sort, or temporary-structure bottleneck.",
      });
    }

    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const severity =
      riskSummary.fullTableScanLikely ||
      riskSummary.usesFilesort ||
      riskSummary.usesTempStructure
        ? (riskSummary.estimatedRows ?? 0) >= 100_000
          ? "high"
          : "warning"
        : "info";

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
        ...resolvedPlanTables.map((tableStats) =>
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
          `Digest summaries show temporary table usage${digestSample.avgTmpTables !== undefined ? ` (avg_tmp_tables=${digestSample.avgTmpTables}` : ""}${digestSample.avgTmpDiskTables !== undefined ? `${digestSample.avgTmpTables !== undefined ? ", " : " ("}avg_tmp_disk_tables=${digestSample.avgTmpDiskTables}` : ""}${(digestSample.avgTmpTables !== undefined || digestSample.avgTmpDiskTables !== undefined) ? ")" : ""}.`,
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
      rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
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
          title: index === 0 ? "Dominant nested wait event" : `Nested wait event ${index + 1}`,
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

  async diagnoseConnectionSpike(
    input: DiagnoseConnectionSpikeInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const processlist = await this.showProcesslist(
      {
        user: input.user,
        host: input.clientHost,
        includeIdle: true,
        includeSystem: false,
        includeInfo: false,
        maxRows: evidenceRowLimit(input.evidenceLevel),
      },
      ctx,
    );
    const rows = parseProcesslistRows(processlist);

    if (rows.length === 0) {
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
        ],
        recommendedActions: [
          "Re-run the diagnostic during the spike window to capture live sessions.",
          "Use show_processlist with broader filters or include_idle=true to inspect connection buildup.",
        ],
        limitations: [
          "This diagnostic currently uses a point-in-time processlist snapshot only.",
          "No CES or control-plane baseline metrics are connected yet.",
        ],
      };
    }

    const sleepSessions = rows.filter((row) => row.command === "Sleep");
    const activeSessions = rows.filter((row) => row.command !== "Sleep");
    const longRunningSessions = rows.filter((row) => (row.timeSeconds ?? 0) >= 60);
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
        rationale:
          `${sleepSessions.length} of ${rows.length} matching sessions are idle (Sleep), which usually points to pooling saturation or clients holding connections open.`,
      });
    }
    if (activeSessions.length >= Math.max(3, Math.ceil(rows.length * 0.4))) {
      rootCauseCandidates.push({
        code: "connection_spike_active_query_backlog",
        title: "Active query backlog",
        confidence: activeSessions.length >= 8 ? "high" : "medium",
        rationale:
          `${activeSessions.length} matching sessions are active, suggesting requests may be piling up behind slow or blocked work.`,
      });
    }
    if (topUser && topUser.count >= Math.max(3, Math.ceil(rows.length * 0.5))) {
      rootCauseCandidates.push({
        code: "connection_spike_single_user_hotspot",
        title: "Single-user hotspot",
        confidence: topUser.count >= 8 ? "high" : "medium",
        rationale:
          `User ${topUser.key} accounts for ${topUser.count} of ${rows.length} matching sessions, which suggests a concentrated source of connection growth.`,
      });
    }
    if (longRunningSessions.length > 0) {
      rootCauseCandidates.push({
        code: "connection_spike_long_running_sessions",
        title: "Long-running sessions are holding connections",
        confidence: longRunningSessions.length >= 3 ? "high" : "medium",
        rationale:
          `${longRunningSessions.length} matching sessions have been active for at least 60 seconds, which can reduce pool turnover and amplify connection growth.`,
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
      rows.length >= 40 || activeSessions.length >= 15 || longRunningSessions.length >= 5
        ? "high"
        : rows.length >= 15 || activeSessions.length >= 5 || longRunningSessions.length >= 2
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
        "Baseline comparison was requested, but only a live processlist snapshot is currently available.",
      );
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

    const evidence = [
      {
        source: "processlist",
        title: "Current processlist snapshot",
        summary:
          `Snapshot captured ${rows.length} matching sessions, including ${activeSessions.length} active and ${sleepSessions.length} idle sessions.`,
      },
      {
        source: "processlist",
        title: "Dominant user and host distribution",
        summary:
          topUser || topHost
            ? `Top user: ${topUser?.key ?? "n/a"} (${topUser?.count ?? 0}); top host: ${topHost?.key ?? "n/a"} (${topHost?.count ?? 0}).`
            : "No dominant user or host distribution was identified.",
      },
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
        "No CES or control-plane connection metrics are connected yet.",
      ],
    };
  }

  async diagnoseLockContention(
    input: DiagnoseLockContentionInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const lockWaits = await this.showLockWaits(
      {
        table: input.table,
        blockerSessionId: input.blockerSessionId,
        includeSql: false,
        maxRows: lockEvidenceRowLimit(input.evidenceLevel),
      },
      ctx,
    );
    const rows = parseLockWaitRows(lockWaits);

    if (rows.length === 0) {
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
          "Metadata locks and deadlock history are not connected yet.",
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
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "lock_contention_snapshot_collected",
        title: "Lock waits are present but no dominant blocker pattern was isolated",
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
            (candidate) => candidate.blockingSessionId === row.blockingSessionId,
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

    const keyFindings = [
      `Collected ${rows.length} current InnoDB lock waits across ${blockerCounts.length} blocker sessions.`,
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

    const evidence = [
      {
        source: "lock_waits",
        title: "Current InnoDB lock-wait snapshot",
        summary: `${rows.length} waits observed across ${blockerCounts.length} blocker sessions and ${tableCounts.length} locked tables.`,
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
              tables: suspiciousTables.length > 0 ? suspiciousTables : undefined,
            }
          : undefined,
      evidence,
      recommendedActions: [...new Set(recommendedActions)],
      limitations: [
        "This diagnostic currently relies on a point-in-time InnoDB lock-wait snapshot only.",
        "Metadata locks and deadlock history are not connected yet.",
      ],
    };
  }

  async diagnoseReplicationLag(
    input: DiagnoseReplicationLagInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    return createPlaceholderDiagnosticResult("diagnose_replication_lag", input, {
      summary: withDatasourceSummary("Replication-lag diagnosis is scaffolded but not implemented", ctx.datasource),
      candidateTitle: "Replication evidence unavailable",
      candidateRationale:
        "This tool needs replica topology, applier state, and lag metrics, but those signals are not connected yet.",
      keyFindings: [
        input.replicaId ? `Replica focus provided: ${input.replicaId}.` : "No replica identifier was provided.",
        input.channel ? `Replication channel provided: ${input.channel}.` : "No replication channel was provided.",
      ],
      recommendedActions: [
        "Validate replication topology and lag metrics before implementing this diagnostic.",
        "Add replica-state and control-plane lag collectors before exposing this tool in production.",
      ],
      limitations: [
        "No replication topology or replica-state collector is connected yet.",
        "No CES lag metric is connected yet.",
      ],
    });
  }

  async diagnoseStoragePressure(
    input: DiagnoseStoragePressureInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const suspiciousTables =
      input.table
        ? [
            {
              table: input.table,
              reason: "Provided as the storage-pressure focus for future SQL and table-level correlation.",
            },
          ]
        : undefined;

    return createPlaceholderDiagnosticResult("diagnose_storage_pressure", input, {
      summary: withDatasourceSummary("Storage-pressure diagnosis is scaffolded but not implemented", ctx.datasource),
      candidateTitle: "Storage evidence not collected",
      candidateRationale:
        "This tool needs CES storage metrics, temporary-table counters, and SQL-level scan evidence, but those collectors are not wired yet.",
      keyFindings: [
        `Scope requested: ${input.scope ?? "instance"}.`,
        suspiciousTables ? `Table focus provided: ${input.table}.` : "No table focus was provided.",
      ],
      suspiciousEntities: suspiciousTables ? { tables: suspiciousTables } : undefined,
      recommendedActions: [
        "Inspect temporary-table, filesort, and disk metrics manually until this diagnostic is implemented.",
        "Add CES storage metrics and SQL evidence collectors before enabling this tool in production.",
      ],
      limitations: [
        "No CES storage metrics are connected yet.",
        "No SQL-to-storage-pressure correlation is performed yet.",
      ],
    });
  }

  async explain(sql: string, ctx: SessionContext): Promise<ExplainResult> {
    return this.executor.explain(sql, ctx);
  }

  async explainEnhanced(sql: string, ctx: SessionContext): Promise<EnhancedExplainResult> {
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
          blockedReason:
            !features.ndp_pushdown.available
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
          blockedReason:
            !features.parallel_query.available
              ? features.parallel_query.reason
              : features.parallel_query.enabled === false
                ? "parallel_query is available but force_parallel_execute is disabled."
                : undefined,
        },
        offsetPushdown:
          hasOffset && features.offset_pushdown.available && features.offset_pushdown.enabled !== false,
      },
      optimizationSuggestions: buildEnhancedExplainSuggestions(sql, features, standardPlan),
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
          currentVersion: (await this.capabilityProbe.getKernelInfo(ctx)).kernelVersion,
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

  async issueConfirmation(input: IssueConfirmationInput): Promise<ConfirmationToken> {
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
