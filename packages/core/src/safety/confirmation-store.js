import { randomBytes } from "node:crypto";
import { normalizeSql, sqlHash } from "../utils/hash.js";
const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const TOKEN_PREFIX = "ctok_";
function allowResult() {
    return {
        valid: true,
        action: "allow",
        riskLevel: "low",
        reasonCodes: [],
        riskHints: [],
    };
}
function blockResult(code, message) {
    return {
        valid: false,
        action: "block",
        riskLevel: "blocked",
        reason: message,
        reasonCodes: [code],
        riskHints: [message],
    };
}
function normalizeDatabase(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function parseTtlSeconds(ttlSeconds, fallback) {
    const resolved = ttlSeconds ?? fallback;
    if (!Number.isInteger(resolved) || resolved <= 0) {
        throw new Error(`Invalid ttlSeconds: ${ttlSeconds}. It must be a positive integer.`);
    }
    return resolved;
}
export class InMemoryConfirmationStore {
    entries = new Map();
    now;
    ttlSeconds;
    randomBytesFn;
    cleanupTimer;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.ttlSeconds = parseTtlSeconds(options.ttlSeconds, DEFAULT_TTL_SECONDS);
        this.randomBytesFn = options.randomBytesFn ?? randomBytes;
        const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
        if (cleanupIntervalMs > 0) {
            this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
            this.cleanupTimer.unref();
        }
    }
    async issue(input) {
        this.cleanupExpired();
        const ttlSeconds = parseTtlSeconds(input.ttlSeconds, this.ttlSeconds);
        const issuedAt = this.now();
        const expiresAt = issuedAt + ttlSeconds * 1000;
        const token = this.generateUniqueToken();
        this.entries.set(token, {
            token,
            sqlHash: input.sqlHash,
            normalizedSql: input.normalizedSql,
            datasource: input.context.datasource,
            database: normalizeDatabase(input.context.database),
            riskLevel: input.riskLevel,
            issuedAt,
            expiresAt,
        });
        return {
            token,
            issuedAt,
            expiresAt,
        };
    }
    async validate(token, currentSql, ctx) {
        const entry = this.entries.get(token);
        if (!entry) {
            return blockResult("CF001", "Confirmation token not found.");
        }
        const now = this.now();
        if (entry.expiresAt <= now) {
            this.entries.delete(token);
            return blockResult("CF002", "Confirmation token has expired.");
        }
        if (entry.usedAt !== undefined) {
            return blockResult("CF005", "Confirmation token has already been used.");
        }
        const normalizedCurrentSql = normalizeSql(currentSql);
        const currentSqlHash = sqlHash(normalizedCurrentSql);
        if (currentSqlHash !== entry.sqlHash) {
            return blockResult("CF003", "SQL hash mismatch for confirmation token.");
        }
        const currentDatabase = normalizeDatabase(ctx.database);
        if (ctx.datasource !== entry.datasource || currentDatabase !== entry.database) {
            return blockResult("CF004", "Datasource or database mismatch for confirmation token.");
        }
        entry.usedAt = now;
        return allowResult();
    }
    async revoke(token) {
        this.entries.delete(token);
    }
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
    cleanupExpired(now = this.now()) {
        for (const [token, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) {
                this.entries.delete(token);
            }
        }
    }
    generateUniqueToken() {
        for (let i = 0; i < 5; i += 1) {
            const token = `${TOKEN_PREFIX}${this.randomBytesFn(32).toString("base64url")}`;
            if (!this.entries.has(token)) {
                return token;
            }
        }
        throw new Error("Unable to generate unique confirmation token.");
    }
}
export function createConfirmationStore(options = {}) {
    return new InMemoryConfirmationStore(options);
}
