import type { TableSchema } from "./introspector.js";
export interface SchemaCacheKey {
    datasource: string;
    database: string;
    table: string;
}
export interface CacheStats {
    size: number;
    maxEntries: number;
    ttlMs: number;
    hits: number;
    misses: number;
    evictions: number;
}
export interface SchemaCache {
    get(key: SchemaCacheKey): TableSchema | undefined;
    set(key: SchemaCacheKey, value: TableSchema): void;
    invalidate(datasource: string, database?: string, table?: string): void;
    stats(): CacheStats;
}
export type InMemorySchemaCacheOptions = {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
};
export declare function makeSchemaCacheKey(key: SchemaCacheKey): string;
export declare class InMemorySchemaCache implements SchemaCache {
    private readonly ttlMs;
    private readonly maxEntries;
    private readonly now;
    private readonly entries;
    private hits;
    private misses;
    private evictions;
    constructor(options?: InMemorySchemaCacheOptions);
    get(key: SchemaCacheKey): TableSchema | undefined;
    set(key: SchemaCacheKey, value: TableSchema): void;
    invalidate(datasource: string, database?: string, table?: string): void;
    stats(): CacheStats;
    private compactExpired;
    private enforceLimit;
}
export declare function createSchemaCache(options?: InMemorySchemaCacheOptions): SchemaCache;
