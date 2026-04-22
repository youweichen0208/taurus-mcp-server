import { type DatabaseEngine, type ProfileLoader } from "./auth/sql-profile-loader.js";
import { type SecretResolver } from "./auth/secret-resolver.js";
import { type Config } from "./config/index.js";
import type { DatasourceResolveInput, DatasourceResolver, SessionContext } from "./context/session-context.js";
import { type ConnectionPool } from "./executor/connection-pool.js";
import { type CancelResult, type ExplainResult, type MutationOptions, type MutationResult, type QueryResult, type QueryStatus, type ReadonlyOptions, type SqlExecutor } from "./executor/sql-executor.js";
import { type ConfirmationStore, type ConfirmationToken, type ConfirmationValidationResult } from "./safety/confirmation-store.js";
import { type Guardrail, type GuardrailDecision, type InspectInput } from "./safety/guardrail.js";
import { type RiskLevel } from "./safety/sql-validator.js";
import { type DatabaseInfo, type SchemaIntrospector, type TableInfo, type TableSchema } from "./schema/introspector.js";
import { type SchemaCache } from "./schema/cache.js";
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
export type ConfirmationOutcome = {
    status: "confirmed";
} | {
    status: "token_issued";
    token: string;
    issuedAt: number;
    expiresAt: number;
};
export interface TaurusDBEngineDeps {
    config: Config;
    profileLoader: ProfileLoader;
    secretResolver: SecretResolver;
    datasourceResolver: DatasourceResolver;
    connectionPool: ConnectionPool;
    schemaCache: SchemaCache;
    schemaIntrospector: SchemaIntrospector;
    guardrail: Guardrail;
    executor: SqlExecutor;
    confirmationStore: ConfirmationStore;
}
export interface TaurusDBEngineCreateOptions {
    config?: Config;
    profileLoader?: ProfileLoader;
    secretResolver?: SecretResolver;
    datasourceResolver?: DatasourceResolver;
    connectionPool?: ConnectionPool;
    schemaCache?: SchemaCache;
    schemaIntrospector?: SchemaIntrospector;
    guardrail?: Guardrail;
    executor?: SqlExecutor;
    confirmationStore?: ConfirmationStore;
}
export declare class TaurusDBEngine {
    readonly config: Config;
    readonly profileLoader: ProfileLoader;
    readonly secretResolver: SecretResolver;
    readonly datasourceResolver: DatasourceResolver;
    readonly connectionPool: ConnectionPool;
    readonly schemaCache: SchemaCache;
    readonly schemaIntrospector: SchemaIntrospector;
    readonly guardrail: Guardrail;
    readonly executor: SqlExecutor;
    readonly confirmationStore: ConfirmationStore;
    constructor(deps: TaurusDBEngineDeps);
    static create(options?: TaurusDBEngineCreateOptions): Promise<TaurusDBEngine>;
    listDataSources(): Promise<DataSourceInfo[]>;
    getDefaultDataSource(): Promise<string | undefined>;
    resolveContext(input: DatasourceResolveInput, taskId: string): Promise<SessionContext>;
    listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
    listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
    describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
    inspectSql(input: InspectInput): Promise<GuardrailDecision>;
    explain(sql: string, ctx: SessionContext): Promise<ExplainResult>;
    executeReadonly(sql: string, ctx: SessionContext, opts?: ReadonlyOptions): Promise<QueryResult>;
    executeMutation(sql: string, ctx: SessionContext, opts?: MutationOptions): Promise<MutationResult>;
    getQueryStatus(queryId: string): Promise<QueryStatus>;
    cancelQuery(queryId: string): Promise<CancelResult>;
    issueConfirmation(input: IssueConfirmationInput): Promise<ConfirmationToken>;
    validateConfirmation(token: string, sql: string, ctx: SessionContext): Promise<ConfirmationValidationResult>;
    handleConfirmation(decision: GuardrailDecision, ctx: SessionContext): Promise<ConfirmationOutcome>;
    close(): Promise<void>;
}
