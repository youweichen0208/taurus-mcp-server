import type { DatabaseEngine, ProfileLoader } from "../auth/sql-profile-loader.js";
import type { CapabilityProbe } from "../capability/probe.js";
import type { Config } from "../config/index.js";
import type { DatasourceResolver, SessionContext } from "../context/session-context.js";
import type { ConnectionPool } from "../executor/connection-pool.js";
import type { ExplainResult, SqlExecutor } from "../executor/sql-executor.js";
import type { MetricsSource } from "../diagnostics/metrics-source.js";
import type { SlowSqlSource } from "../diagnostics/slow-sql-source.js";
import type { SecretResolver } from "../auth/secret-resolver.js";
import type { ConfirmationStore } from "../safety/confirmation-store.js";
import type { Guardrail } from "../safety/guardrail.js";
import type { RiskLevel } from "../safety/sql-validator.js";
import type { SchemaIntrospector } from "../schema/introspector.js";

export interface DataSourceInfo {
  name: string;
  engine: DatabaseEngine;
  host?: string;
  port: number;
  database?: string;
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
      status: "approval_required";
      request: string;
      requestId: string;
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
  featureExplanations: {
    offsetPushdown: {
      matched: boolean;
      meaning: string;
      whyTriggered: string;
      expectedBenefit: string;
    };
    parallelQuery: {
      matched: boolean;
      meaning: string;
      whyTriggered: string;
      expectedBenefit: string;
    };
    ndpPushdown: {
      matched: boolean;
      meaning: string;
      whyTriggered: string;
      expectedBenefit: string;
    };
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
