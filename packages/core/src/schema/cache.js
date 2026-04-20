const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;
function normalizeName(value) {
    return value.trim().toLowerCase();
}
export function makeSchemaCacheKey(key) {
    return `${normalizeName(key.datasource)}::${normalizeName(key.database)}::${normalizeName(key.table)}`;
}
export class InMemorySchemaCache {
    ttlMs;
    maxEntries;
    now;
    entries = new Map();
    hits = 0;
    misses = 0;
    evictions = 0;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.now = options.now ?? Date.now;
    }
    get(key) {
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
    set(key, value) {
        const cacheKey = makeSchemaCacheKey(key);
        const entry = {
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
    invalidate(datasource, database, table) {
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
    stats() {
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
    compactExpired() {
        const now = this.now();
        for (const [key, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }
    enforceLimit() {
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
export function createSchemaCache(options) {
    return new InMemorySchemaCache(options);
}
