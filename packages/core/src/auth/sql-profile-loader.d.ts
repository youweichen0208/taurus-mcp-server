import type { Config } from "../config/index.js";
export type DatabaseEngine = "mysql" | "postgresql";
export type CredentialRef = {
    type: "plain";
    value: string;
} | {
    type: "env";
    key: string;
} | {
    type: "file";
    path: string;
} | {
    type: "uri";
    uri: string;
};
export interface UserCredential {
    username: string;
    password: CredentialRef;
}
export interface TlsOptions {
    enabled?: boolean;
    rejectUnauthorized?: boolean;
    servername?: string;
    ca?: CredentialRef;
    cert?: CredentialRef;
    key?: CredentialRef;
}
export interface DataSourceProfile {
    name: string;
    engine: DatabaseEngine;
    host: string;
    port: number;
    database?: string;
    readonlyUser: UserCredential;
    mutationUser?: UserCredential;
    tls?: TlsOptions;
    poolSize?: number;
    toString(): string;
}
export interface ProfileLoader {
    load(): Promise<Map<string, DataSourceProfile>>;
    getDefault(): Promise<string | undefined>;
    get(name: string): Promise<DataSourceProfile | undefined>;
}
export type SqlProfileLoaderOptions = {
    config: Config;
    env?: NodeJS.ProcessEnv;
};
export declare function redactDataSourceProfile(profile: DataSourceProfile): Record<string, unknown>;
export declare class SqlProfileLoader implements ProfileLoader {
    private readonly config;
    private readonly env;
    private cache;
    private pending;
    constructor(options: SqlProfileLoaderOptions);
    load(): Promise<Map<string, DataSourceProfile>>;
    getDefault(): Promise<string | undefined>;
    get(name: string): Promise<DataSourceProfile | undefined>;
    private ensureLoaded;
    private loadInternal;
}
export declare function createSqlProfileLoader(options: SqlProfileLoaderOptions): ProfileLoader;
