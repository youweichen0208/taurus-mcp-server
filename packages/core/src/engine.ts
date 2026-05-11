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
  type FlashbackInput,
} from "./taurus/flashback.js";
import {
  type RestoreRecycleBinTableInput,
} from "./taurus/recycle-bin.js";
import {
  type DbHotspotResult,
  type DiagnoseDbHotspotInput,
  type DiagnoseServiceLatencyInput,
  type FindTopSlowSqlInput,
  type FindTopSlowSqlResult,
  type DiagnoseConnectionSpikeInput,
  type DiagnoseLockContentionInput,
  type DiagnoseSlowQueryInput,
  type DiagnoseStoragePressureInput,
  type DiagnosticResult,
  type ServiceLatencyResult,
} from "./diagnostics/types.js";
import {
  createSlowSqlSource,
  type SlowSqlSource,
} from "./diagnostics/slow-sql-source.js";
import {
  createMetricsSource,
  type MetricsSource,
} from "./diagnostics/metrics-source.js";
import {
  findLatestDeadlock,
  findMetadataLockWaits,
  findStatementDigestCandidatesForSqlHints,
  findStatementDigestSample,
  findStatementDigestSampleForSql,
  findStatementWaitEvents,
  findStorageStatementDigests,
  findTableStorageStats,
  findTopStatementDigests,
  isPerformanceSchemaEnabled,
  showLockWaits,
  showProcesslist,
} from "./engine/data-access.js";
import {
  diagnoseConnectionSpike,
  diagnoseDbHotspot,
  diagnoseLockContention,
  diagnoseServiceLatency,
  diagnoseSlowQuery,
  diagnoseStoragePressure,
  findTopSlowSql,
} from "./engine/diagnostics.js";
import {
  cancelQuery,
  close,
  executeMutation,
  executeReadonly,
  explain,
  explainEnhanced,
  flashbackQuery,
  getQueryStatus,
  handleConfirmation,
  issueConfirmation,
  listRecycleBin,
  restoreRecycleBinTable,
  validateConfirmation,
} from "./engine/runtime.js";
import type {
  ConfirmationOutcome,
  DataSourceInfo,
  EnhancedExplainResult,
  IssueConfirmationInput,
  ShowLockWaitsInput,
  ShowProcesslistInput,
  TaurusDBEngineCreateOptions,
  TaurusDBEngineDeps,
} from "./engine/types.js";
import {
  type DeadlockSummary,
  type MetadataLockRow,
  type StatementDigestRow,
  type StatementWaitEventRow,
  type TableStorageRow,
} from "./engine/helpers.js";

export type {
  ConfirmationOutcome,
  DataSourceInfo,
  EnhancedExplainResult,
  IssueConfirmationInput,
  ShowLockWaitsInput,
  ShowProcesslistInput,
  TaurusDBEngineCreateOptions,
  TaurusDBEngineDeps,
} from "./engine/types.js";

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
    return showProcesslist(this, input, ctx);
  }

  async showLockWaits(
    input: ShowLockWaitsInput,
    ctx: SessionContext,
  ): Promise<QueryResult> {
    return showLockWaits(this, input, ctx);
  }

  async findMetadataLockWaits(
    input: DiagnoseLockContentionInput,
    ctx: SessionContext,
  ): Promise<MetadataLockRow[]> {
    return findMetadataLockWaits(this, input, ctx);
  }

  async findLatestDeadlock(
    ctx: SessionContext,
  ): Promise<DeadlockSummary | undefined> {
    return findLatestDeadlock(this, ctx);
  }

  async findStatementDigestSample(
    digestText: string,
    ctx: SessionContext,
  ): Promise<StatementDigestRow | undefined> {
    return findStatementDigestSample(this, digestText, ctx);
  }

  async findStatementDigestSampleForSql(
    sql: string,
    ctx: SessionContext,
  ): Promise<StatementDigestRow | undefined> {
    return findStatementDigestSampleForSql(this, sql, ctx);
  }

  async findStatementDigestCandidatesForSqlHints(
    sqlText: string,
    ctx: SessionContext,
  ): Promise<StatementDigestRow[]> {
    return findStatementDigestCandidatesForSqlHints(this, sqlText, ctx);
  }

  async findTopStatementDigests(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<StatementDigestRow[]> {
    return findTopStatementDigests(this, input, ctx);
  }

  async isPerformanceSchemaEnabled(
    ctx: SessionContext,
  ): Promise<boolean | undefined> {
    return isPerformanceSchemaEnabled(this, ctx);
  }

  async findStorageStatementDigests(
    input: DiagnoseStoragePressureInput,
    ctx: SessionContext,
  ): Promise<StatementDigestRow[]> {
    return findStorageStatementDigests(this, input, ctx);
  }

  async findStatementWaitEvents(
    digestText: string,
    ctx: SessionContext,
  ): Promise<StatementWaitEventRow[]> {
    return findStatementWaitEvents(this, digestText, ctx);
  }

  async findTableStorageStats(
    input: DiagnoseStoragePressureInput,
    ctx: SessionContext,
  ): Promise<TableStorageRow[]> {
    return findTableStorageStats(this, input, ctx);
  }

  async diagnoseSlowQuery(
    input: DiagnoseSlowQueryInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    return diagnoseSlowQuery(this, input, ctx);
  }

  async diagnoseServiceLatency(
    input: DiagnoseServiceLatencyInput,
    ctx: SessionContext,
  ): Promise<ServiceLatencyResult> {
    return diagnoseServiceLatency(this, input, ctx);
  }

  async diagnoseDbHotspot(
    input: DiagnoseDbHotspotInput,
    ctx: SessionContext,
  ): Promise<DbHotspotResult> {
    return diagnoseDbHotspot(this, input, ctx);
  }

  async findTopSlowSql(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<FindTopSlowSqlResult> {
    return findTopSlowSql(this, input, ctx);
  }

  async diagnoseConnectionSpike(
    input: DiagnoseConnectionSpikeInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    return diagnoseConnectionSpike(this, input, ctx);
  }

  async diagnoseLockContention(
    input: DiagnoseLockContentionInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    return diagnoseLockContention(this, input, ctx);
  }

  async diagnoseStoragePressure(
    input: DiagnoseStoragePressureInput,
    ctx: SessionContext,
  ): Promise<DiagnosticResult> {
    return diagnoseStoragePressure(this, input, ctx);
  }

  async explain(sql: string, ctx: SessionContext): Promise<ExplainResult> {
    return explain(this, sql, ctx);
  }

  async explainEnhanced(
    sql: string,
    ctx: SessionContext,
  ): Promise<EnhancedExplainResult> {
    return explainEnhanced(this, sql, ctx);
  }

  async executeReadonly(
    sql: string,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    return executeReadonly(this, sql, ctx, opts);
  }

  async executeMutation(
    sql: string,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult> {
    return executeMutation(this, sql, ctx, opts);
  }

  async flashbackQuery(
    input: FlashbackInput,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    return flashbackQuery(this, input, ctx, opts);
  }

  async listRecycleBin(
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    return listRecycleBin(this, ctx, opts);
  }

  async restoreRecycleBinTable(
    input: RestoreRecycleBinTableInput,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult> {
    return restoreRecycleBinTable(this, input, ctx, opts);
  }

  async getQueryStatus(queryId: string): Promise<QueryStatus> {
    return getQueryStatus(this, queryId);
  }

  async cancelQuery(queryId: string): Promise<CancelResult> {
    return cancelQuery(this, queryId);
  }

  async issueConfirmation(
    input: IssueConfirmationInput,
  ): Promise<ConfirmationToken> {
    return issueConfirmation(this, input);
  }

  async validateConfirmation(
    token: string,
    sql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult> {
    return validateConfirmation(this, token, sql, ctx);
  }

  async handleConfirmation(
    decision: GuardrailDecision,
    ctx: SessionContext,
  ): Promise<ConfirmationOutcome> {
    return handleConfirmation(this, decision, ctx);
  }

  async close(): Promise<void> {
    return close(this);
  }

}
