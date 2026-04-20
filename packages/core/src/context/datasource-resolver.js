export class DatasourceResolutionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DatasourceResolutionError";
        this.code = code;
    }
}
function normalizeString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function resolveTimeoutMs(requested, fallbackMax) {
    if (requested === undefined) {
        return fallbackMax;
    }
    if (!Number.isInteger(requested) || requested <= 0) {
        throw new DatasourceResolutionError("INVALID_CONTEXT_INPUT", `Invalid timeout_ms: ${requested}. It must be a positive integer.`);
    }
    return Math.min(requested, fallbackMax);
}
export class DefaultDatasourceResolver {
    config;
    profileLoader;
    constructor(options) {
        this.config = options.config;
        this.profileLoader = options.profileLoader;
    }
    async resolve(input, task_id) {
        const datasourceName = await this.resolveDatasourceName(input.datasource);
        const profile = await this.profileLoader.get(datasourceName);
        if (!profile) {
            throw new DatasourceResolutionError("DATASOURCE_NOT_FOUND", `Datasource profile "${datasourceName}" was not found.`);
        }
        return {
            task_id,
            datasource: datasourceName,
            engine: profile.engine,
            database: normalizeString(input.database) ?? profile.database,
            schema: normalizeString(input.schema),
            limits: {
                readonly: input.readonly ?? true,
                timeoutMs: resolveTimeoutMs(input.timeout_ms, this.config.limits.maxStatementMs),
                maxRows: this.config.limits.maxRows,
                maxColumns: this.config.limits.maxColumns,
                maxFieldChars: this.config.limits.maxFieldChars,
            },
        };
    }
    async resolveDatasourceName(explicitDatasource) {
        const inputDatasource = normalizeString(explicitDatasource);
        if (inputDatasource) {
            return inputDatasource;
        }
        if (this.config.defaultDatasource) {
            return this.config.defaultDatasource;
        }
        const loadedDefault = await this.profileLoader.getDefault();
        const profileDefault = normalizeString(loadedDefault);
        if (profileDefault) {
            return profileDefault;
        }
        throw new DatasourceResolutionError("DATASOURCE_NOT_FOUND", "No datasource selected. Provide input.datasource or configure a default datasource.");
    }
}
export function createDatasourceResolver(options) {
    return new DefaultDatasourceResolver(options);
}
