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

type Entry = {
  key: string;
  value: TableSchema;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function makeSchemaCacheKey(key: SchemaCacheKey): string {
  return `${normalizeName(key.datasource)}::${normalizeName(
    key.database
  )}::${normalizeName(key.table)}`;
}

export class InMemorySchemaCache implements SchemaCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: InMemorySchemaCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  get(key: SchemaCacheKey): TableSchema | undefined {
    const cacheKey = makeSchemaCacheKey(key);
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cacheKey);
      this.misses += 1;
      return undefined;
    }

    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: SchemaCacheKey, value: TableSchema): void {
    const cacheKey = makeSchemaCacheKey(key);
    const entry: Entry = {
      key: cacheKey,
      value,
      expiresAt: this.now() + this.ttlMs,
    };

    if (this.entries.has(cacheKey)) {
      this.entries.delete(cacheKey);
    }
    this.entries.set(cacheKey, entry);
    this.compactExpired();
    this.enforceLimit();
  }

  invalidate(datasource: string, database?: string, table?: string): void {
    const ds = normalizeName(datasource);
    const db = database ? normalizeName(database) : undefined;
    const tb = table ? normalizeName(table) : undefined;

    for (const key of this.entries.keys()) {
      const [kDatasource, kDatabase, kTable] = key.split("::");
      if (kDatasource !== ds) {
        continue;
      }
      if (db && kDatabase !== db) {
        continue;
      }
      if (tb && kTable !== tb) {
        continue;
      }
      this.entries.delete(key);
    }
  }

  stats(): CacheStats {
    this.compactExpired();
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private compactExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private enforceLimit(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
      this.evictions += 1;
    }
  }
}

export function createSchemaCache(
  options?: InMemorySchemaCacheOptions
): SchemaCache {
  return new InMemorySchemaCache(options);
}
