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
  type DiagnosticResult,
} from "./diagnostics/types.js";
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

function withDatasourceSummary(prefix: string, datasource: string): string {
  return `${prefix} on datasource ${datasource}.`;
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

  async diagnoseSlowQuery(
    input: DiagnoseSlowQueryInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const suspiciousSql =
      input.sql || input.sqlHash || input.digestText
        ? [
            {
              sqlHash: input.sqlHash,
              digestText: input.digestText,
              reason: "Provided as the diagnosis target for future explain and slow-SQL correlation.",
            },
          ]
        : undefined;

    return createPlaceholderDiagnosticResult("diagnose_slow_query", input, {
      summary: withDatasourceSummary("Slow-query diagnosis is scaffolded but not implemented", ctx.datasource),
      candidateTitle: "Evidence collectors pending",
      candidateRationale:
        "This tool has a stable contract, but explain correlation, slow-SQL sampling, and TaurusDB feature analysis are not wired yet.",
      keyFindings: [
        suspiciousSql ? "A target SQL identifier was provided for future correlation." : "No target SQL identifier was provided yet.",
        "No explain, slow-SQL, or table-statistics evidence was collected in this run.",
      ],
      suspiciousEntities: suspiciousSql ? { sqls: suspiciousSql } : undefined,
      recommendedActions: [
        "Use explain_sql or explain_sql_enhanced for immediate plan inspection.",
        "Implement slow-SQL collectors and table/index evidence before enabling this tool in production.",
      ],
      limitations: [
        "No slow-SQL source is connected yet.",
        "No live EXPLAIN or TaurusDB feature correlation is performed yet.",
      ],
    });
  }

  async diagnoseConnectionSpike(
    input: DiagnoseConnectionSpikeInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const suspiciousUsers =
      input.user
        ? [
            {
              user: input.user,
              clientHost: input.clientHost,
              reason: "Provided as the connection spike focus for future processlist and metric correlation.",
            },
          ]
        : undefined;

    return createPlaceholderDiagnosticResult("diagnose_connection_spike", input, {
      summary: withDatasourceSummary("Connection-spike diagnosis is scaffolded but not implemented", ctx.datasource),
      candidateTitle: "Connection evidence not collected",
      candidateRationale:
        "This tool needs processlist snapshots, connection counters, and control-plane metrics, but those collectors are not wired yet.",
      keyFindings: [
        input.compareBaseline ? "Baseline comparison was requested." : "Baseline comparison was not requested.",
        "No CES connection metrics or processlist snapshots were collected in this run.",
      ],
      suspiciousEntities: suspiciousUsers ? { users: suspiciousUsers } : undefined,
      recommendedActions: [
        "Inspect processlist and connection counters manually until this diagnostic is implemented.",
        "Add CES and connection-state collectors before exposing this tool by default.",
      ],
      limitations: [
        "No control-plane metrics are connected yet.",
        "No live processlist or thread-state evidence is collected yet.",
      ],
    });
  }

  async diagnoseLockContention(
    input: DiagnoseLockContentionInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    const suspiciousEntities = {
      sessions: input.blockerSessionId
        ? [
            {
              sessionId: input.blockerSessionId,
              reason: "Provided as the suspected blocker session for future wait-chain analysis.",
            },
          ]
        : undefined,
      tables: input.table
        ? [
            {
              table: input.table,
              reason: "Provided as the suspected lock hotspot for future blocker/waiter correlation.",
            },
          ]
        : undefined,
    };

    return createPlaceholderDiagnosticResult("diagnose_lock_contention", input, {
      summary: withDatasourceSummary("Lock-contention diagnosis is scaffolded but not implemented", ctx.datasource),
      candidateTitle: "Wait-chain analysis pending",
      candidateRationale:
        "This tool needs lock-wait views, long-transaction snapshots, and deadlock evidence, but those collectors are not wired yet.",
      keyFindings: [
        input.table ? `Table focus provided: ${input.table}.` : "No table focus was provided.",
        input.blockerSessionId
          ? `Potential blocker session provided: ${input.blockerSessionId}.`
          : "No blocker session identifier was provided.",
      ],
      suspiciousEntities:
        suspiciousEntities.sessions || suspiciousEntities.tables ? suspiciousEntities : undefined,
      recommendedActions: [
        "Inspect blocker and waiter sessions manually until wait-chain collectors are implemented.",
        "Add lock-wait, deadlock, and metadata-lock collectors before enabling this tool in production.",
      ],
      limitations: [
        "No lock-wait or deadlock view is queried yet.",
        "No blocker/waiter chain is constructed yet.",
      ],
    });
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
