import type { Config } from "../config/index.js";
import type { ProfileLoader } from "../auth/sql-profile-loader.js";
import type { DatasourceResolveInput, DatasourceResolver, SessionContext } from "./session-context.js";
export declare class DatasourceResolutionError extends Error {
    readonly code: "DATASOURCE_NOT_FOUND" | "INVALID_CONTEXT_INPUT";
    constructor(code: "DATASOURCE_NOT_FOUND" | "INVALID_CONTEXT_INPUT", message: string);
}
export type DatasourceResolverOptions = {
    config: Config;
    profileLoader: ProfileLoader;
};
export declare class DefaultDatasourceResolver implements DatasourceResolver {
    private readonly config;
    private readonly profileLoader;
    constructor(options: DatasourceResolverOptions);
    resolve(input: DatasourceResolveInput, task_id: string): Promise<SessionContext>;
    private resolveDatasourceName;
}
export declare function createDatasourceResolver(options: DatasourceResolverOptions): DatasourceResolver;
