import type { Config } from "../config/index.js";
import type { DatabaseEngine, ProfileLoader } from "../auth/sql-profile-loader.js";
import type { SecretResolver } from "../auth/secret-resolver.js";
export type PoolMode = "ro" | "rw";
export interface ExecOptions {
    timeoutMs?: number;
}
export interface RawResult {
    rows?: unknown[];
    rowCount?: number;
    affectedRows?: number;
    fields?: Array<{
        name: string;
        type?: string;
    }>;
    raw?: unknown;
}
export interface Session {
    id: string;
    datasource: string;
    mode: PoolMode;
    execute(sql: string, options?: ExecOptions): Promise<RawResult>;
    cancel(): Promise<void>;
    close(): Promise<void>;
}
export interface ModeHealth {
    mode: PoolMode;
    status: "ok" | "error" | "skipped";
    message?: string;
}
export interface PoolHealth {
    datasource: string;
    checkedAt: string;
    modes: ModeHealth[];
}
export interface ConnectionPool {
    acquire(datasource: string, mode: PoolMode): Promise<Session>;
    release(session: Session): Promise<void>;
    healthCheck(datasource: string): Promise<PoolHealth>;
    close(): Promise<void>;
}
export interface DriverSession {
    execute(sql: string, options?: ExecOptions): Promise<RawResult>;
    cancel(): Promise<void>;
    release(): Promise<void>;
}
export interface DriverPool {
    acquire(): Promise<DriverSession>;
    close(): Promise<void>;
}
export interface DriverPoolCreateInput {
    datasource: string;
    mode: PoolMode;
    engine: DatabaseEngine;
    host: string;
    port: number;
    database?: string;
    username: string;
    password: string;
    poolSize?: number;
    tls?: {
        enabled?: boolean;
        rejectUnauthorized?: boolean;
        servername?: string;
        ca?: string;
        cert?: string;
        key?: string;
    };
}
export interface DriverAdapter {
    createPool(input: DriverPoolCreateInput): Promise<DriverPool>;
}
export type ConnectionPoolManagerOptions = {
    config: Config;
    profileLoader: ProfileLoader;
    secretResolver: SecretResolver;
    adapters: Partial<Record<DatabaseEngine, DriverAdapter>>;
};
export declare class ConnectionPoolError extends Error {
    readonly code = "CONNECTION_FAILED";
    constructor(message: string, cause?: unknown);
}
export declare class ConnectionPoolManager implements ConnectionPool {
    private readonly config;
    private readonly profileLoader;
    private readonly secretResolver;
    private readonly adapters;
    private readonly pools;
    private readonly activeSessions;
    constructor(options: ConnectionPoolManagerOptions);
    acquire(datasource: string, mode: PoolMode): Promise<Session>;
    release(session: Session): Promise<void>;
    healthCheck(datasource: string): Promise<PoolHealth>;
    close(): Promise<void>;
    private healthCheckMode;
    private getOrCreatePool;
    private createPool;
}
export declare function createConnectionPoolManager(options: ConnectionPoolManagerOptions): ConnectionPoolManager;
