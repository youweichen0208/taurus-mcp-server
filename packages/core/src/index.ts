export { TaurusDBEngine } from "./engine.js";
export type {
  EnhancedExplainResult,
  ConfirmationOutcome,
  DataSourceInfo,
  IssueConfirmationInput,
  TaurusDBEngineCreateOptions,
  TaurusDBEngineDeps,
} from "./engine.js";

export {
  createConfigFromEnv,
  getConfig,
  redactConfigForLog,
  resetConfigForTests,
} from "./config/index.js";
export type { Config } from "./config/index.js";

export { DatasourceResolutionError } from "./context/datasource-resolver.js";
export type {
  DatasourceResolveInput,
  DatasourceResolver,
  RuntimeLimits,
  SessionContext,
} from "./context/session-context.js";

export { ConnectionPoolError } from "./executor/connection-pool.js";
export type {
  CancelResult,
  ExplainResult,
  MutationOptions,
  MutationResult,
  QueryResult,
  QueryStatus,
  ReadonlyOptions,
  SqlExecutor,
} from "./executor/sql-executor.js";

export { createCapabilityProbe } from "./capability/probe.js";
export type { CapabilityProbe } from "./capability/probe.js";
export { UnsupportedFeatureError } from "./capability/types.js";
export type {
  CapabilitySnapshot,
  FeatureMatrix,
  FeatureStatus,
  KernelInfo,
  TaurusFeatureName,
} from "./capability/types.js";

export {
  createConfirmationStore,
  InMemoryConfirmationStore,
} from "./safety/confirmation-store.js";
export type {
  ConfirmationStore,
  ConfirmationToken,
  ConfirmationValidationResult,
  IssueInput,
} from "./safety/confirmation-store.js";

export { createGuardrail } from "./safety/guardrail.js";
export type {
  Guardrail,
  GuardrailDecision,
  GuardrailRuntimeLimits,
  InspectInput,
} from "./safety/guardrail.js";
export type { ExplainRiskSummary, RiskLevel, ValidationResult } from "./safety/sql-validator.js";

export { SchemaIntrospectionError } from "./schema/introspector.js";
export type {
  ColumnInfo,
  DatabaseInfo,
  IndexInfo,
  SchemaIntrospector,
  TableInfo,
  TableSchema,
} from "./schema/introspector.js";

export {
  ErrorCode,
  formatBlocked,
  formatConfirmationRequired,
  formatError,
  formatSuccess,
} from "./utils/formatter.js";
export type {
  ErrorCode as ErrorCodeValue,
  ResponseMetadata,
  StatementType,
  ToolError,
  ToolResponse,
} from "./utils/formatter.js";

export { normalizeSql, sqlHash } from "./utils/hash.js";
export { generateQueryId, generateTaskId } from "./utils/id.js";
export { logger, withTaskContext } from "./utils/logger.js";
export type { FlashbackInput } from "./taurus/flashback.js";
export { createPlaceholderDiagnosticResult } from "./diagnostics/types.js";
export {
  buildResolveSlowSqlInput,
  createSlowSqlSource,
  TaurusApiSlowSqlSource,
} from "./diagnostics/slow-sql-source.js";
export {
  CesMetricsSource,
  createMetricsSource,
} from "./diagnostics/metrics-source.js";
export type {
  DbHotspotItem,
  DbHotspotResult,
  DiagnosticBaseInput,
  DiagnosticConfidence,
  DiagnosticEvidenceItem,
  DiagnosticEvidenceLevel,
  DiagnosticNextToolInput,
  DiagnoseDbHotspotInput,
  DiagnoseServiceLatencyInput,
  FindTopSlowSqlInput,
  FindTopSlowSqlResult,
  DiagnosticResult,
  DiagnosticRootCauseCandidate,
  DiagnosticSeverity,
  DiagnosticStatus,
  ServiceLatencyCandidate,
  ServiceLatencyResult,
  ServiceLatencySuspectedCategory,
  DiagnosticSuspiciousEntities,
  DiagnosticToolName,
  DiagnosisWindow,
  DiagnoseConnectionSpikeInput,
  DiagnoseLockContentionInput,
  DiagnoseReplicationLagInput,
  DiagnoseSlowQueryInput,
  DiagnoseStoragePressureInput,
  PlaceholderDiagnosticOptions,
  TopSlowSqlItem,
} from "./diagnostics/types.js";
export type {
  ExternalSlowSqlSample,
  ResolveSlowSqlInput,
  SlowSqlSource,
} from "./diagnostics/slow-sql-source.js";
export type {
  MetricAlias,
  MetricPoint,
  MetricSummary,
  MetricsSource,
  QueryMetricsInput,
} from "./diagnostics/metrics-source.js";
