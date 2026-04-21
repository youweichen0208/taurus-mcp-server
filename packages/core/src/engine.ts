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
  type SampleResult,
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

  async sampleRows(
    ctx: SessionContext,
    database: string,
    table: string,
    n: number,
  ): Promise<SampleResult> {
    return this.schemaIntrospector.sampleRows(ctx, database, table, n);
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
