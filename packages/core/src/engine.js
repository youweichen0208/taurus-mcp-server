import { createSqlProfileLoader, } from "./auth/sql-profile-loader.js";
import { createSecretResolver, } from "./auth/secret-resolver.js";
import { getConfig } from "./config/index.js";
import { createDatasourceResolver, } from "./context/datasource-resolver.js";
import { createConnectionPoolManager, } from "./executor/connection-pool.js";
import { createSqlExecutor, } from "./executor/sql-executor.js";
import { createConfirmationStore, InMemoryConfirmationStore, } from "./safety/confirmation-store.js";
import { createGuardrail, } from "./safety/guardrail.js";
import { createSchemaIntrospector, } from "./schema/introspector.js";
import { createMySqlSchemaAdapter } from "./schema/adapters/mysql.js";
import { createSchemaCache } from "./schema/cache.js";
import { normalizeSql, sqlHash } from "./utils/hash.js";
function toDataSourceInfo(profile, defaultDatasource) {
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
function resolveConfirmationSql(input) {
    const normalized = input.normalizedSql ?? (input.sql ? normalizeSql(input.sql) : undefined);
    const hash = input.sqlHash ?? (normalized ? sqlHash(normalized) : undefined);
    if (!normalized || !hash) {
        throw new Error("Issue confirmation requires sql, normalizedSql, or sqlHash context.");
    }
    return { normalized, hash };
}
export class TaurusDBEngine {
    config;
    profileLoader;
    secretResolver;
    datasourceResolver;
    connectionPool;
    schemaCache;
    schemaIntrospector;
    guardrail;
    executor;
    confirmationStore;
    constructor(deps) {
        this.config = deps.config;
        this.profileLoader = deps.profileLoader;
        this.secretResolver = deps.secretResolver;
        this.datasourceResolver = deps.datasourceResolver;
        this.connectionPool = deps.connectionPool;
        this.schemaCache = deps.schemaCache;
        this.schemaIntrospector = deps.schemaIntrospector;
        this.guardrail = deps.guardrail;
        this.executor = deps.executor;
        this.confirmationStore = deps.confirmationStore;
    }
    static async create(options = {}) {
        const config = options.config ?? getConfig();
        const profileLoader = options.profileLoader ?? createSqlProfileLoader({ config });
        const secretResolver = options.secretResolver ?? createSecretResolver();
        const datasourceResolver = options.datasourceResolver ??
            createDatasourceResolver({
                config,
                profileLoader,
            });
        const connectionPool = options.connectionPool ??
            createConnectionPoolManager({
                config,
                profileLoader,
                secretResolver,
                adapters: {},
            });
        const schemaCache = options.schemaCache ?? createSchemaCache();
        const schemaIntrospector = options.schemaIntrospector ??
            createSchemaIntrospector({
                adapters: {
                    mysql: createMySqlSchemaAdapter({ connectionPool, schemaCache }),
                },
            });
        const executor = options.executor ??
            createSqlExecutor({
                connectionPool,
            });
        const guardrail = options.guardrail ??
            createGuardrail({
                schemaIntrospector,
                executor,
            });
        const confirmationStore = options.confirmationStore ?? createConfirmationStore();
        return new TaurusDBEngine({
            config,
            profileLoader,
            secretResolver,
            datasourceResolver,
            connectionPool,
            schemaCache,
            schemaIntrospector,
            guardrail,
            executor,
            confirmationStore,
        });
    }
    async listDataSources() {
        const [profiles, defaultDatasource] = await Promise.all([
            this.profileLoader.load(),
            this.profileLoader.getDefault(),
        ]);
        return [...profiles.values()]
            .map((profile) => toDataSourceInfo(profile, defaultDatasource))
            .sort((left, right) => left.name.localeCompare(right.name));
    }
    async getDefaultDataSource() {
        return this.profileLoader.getDefault();
    }
    async resolveContext(input, taskId) {
        return this.datasourceResolver.resolve(input, taskId);
    }
    async listDatabases(ctx) {
        return this.schemaIntrospector.listDatabases(ctx);
    }
    async listTables(ctx, database) {
        return this.schemaIntrospector.listTables(ctx, database);
    }
    async describeTable(ctx, database, table) {
        return this.schemaIntrospector.describeTable(ctx, database, table);
    }
    async inspectSql(input) {
        return this.guardrail.inspect(input);
    }
    async explain(sql, ctx) {
        return this.executor.explain(sql, ctx);
    }
    async executeReadonly(sql, ctx, opts) {
        return this.executor.executeReadonly(sql, ctx, opts);
    }
    async executeMutation(sql, ctx, opts) {
        return this.executor.executeMutation(sql, ctx, opts);
    }
    async getQueryStatus(queryId) {
        return this.executor.getQueryStatus(queryId);
    }
    async cancelQuery(queryId) {
        return this.executor.cancelQuery(queryId);
    }
    async issueConfirmation(input) {
        const resolved = resolveConfirmationSql(input);
        return this.confirmationStore.issue({
            sqlHash: resolved.hash,
            normalizedSql: resolved.normalized,
            context: input.context,
            riskLevel: input.riskLevel,
            ttlSeconds: input.ttlSeconds,
        });
    }
    async validateConfirmation(token, sql, ctx) {
        return this.confirmationStore.validate(token, sql, ctx);
    }
    async handleConfirmation(decision, ctx) {
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
    async close() {
        await this.connectionPool.close();
        if (this.confirmationStore instanceof InMemoryConfirmationStore) {
            this.confirmationStore.stop();
        }
    }
}
