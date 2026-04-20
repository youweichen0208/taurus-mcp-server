import { ulid } from "ulid";
export class ConnectionPoolError extends Error {
    code = "CONNECTION_FAILED";
    constructor(message, cause) {
        super(message);
        this.name = "ConnectionPoolError";
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
function poolKey(datasource, mode) {
    return `${datasource}:${mode}`;
}
async function resolveTls(tls, secretResolver) {
    if (!tls) {
        return undefined;
    }
    const resolved = {
        enabled: tls.enabled,
        rejectUnauthorized: tls.rejectUnauthorized,
        servername: tls.servername,
    };
    if (tls.ca) {
        resolved.ca = await secretResolver.resolve(tls.ca);
    }
    if (tls.cert) {
        resolved.cert = await secretResolver.resolve(tls.cert);
    }
    if (tls.key) {
        resolved.key = await secretResolver.resolve(tls.key);
    }
    return resolved;
}
function ensureMutationAllowed(config) {
    if (!config.enableMutations) {
        throw new ConnectionPoolError("Mutation mode is disabled by configuration.");
    }
}
function selectCredential(profile, mode) {
    if (mode === "ro") {
        return profile.readonlyUser;
    }
    if (!profile.mutationUser) {
        throw new ConnectionPoolError(`Mutation user is not configured for datasource "${profile.name}".`);
    }
    return profile.mutationUser;
}
async function resolveCredentialValue(ref, secretResolver, context) {
    try {
        return await secretResolver.resolve(ref);
    }
    catch (error) {
        throw new ConnectionPoolError(`Failed to resolve credential for ${context}.`, error);
    }
}
export class ConnectionPoolManager {
    config;
    profileLoader;
    secretResolver;
    adapters;
    pools = new Map();
    activeSessions = new Map();
    constructor(options) {
        this.config = options.config;
        this.profileLoader = options.profileLoader;
        this.secretResolver = options.secretResolver;
        this.adapters = options.adapters;
    }
    async acquire(datasource, mode) {
        const profile = await this.profileLoader.get(datasource);
        if (!profile) {
            throw new ConnectionPoolError(`Datasource profile not found: "${datasource}".`);
        }
        if (mode === "rw") {
            ensureMutationAllowed(this.config);
        }
        const entry = await this.getOrCreatePool(profile, mode);
        let driverSession;
        try {
            driverSession = await entry.pool.acquire();
        }
        catch (error) {
            throw new ConnectionPoolError(`Failed to acquire database session for datasource "${datasource}".`, error);
        }
        const sessionId = `sess_${ulid().toLowerCase()}`;
        const active = {
            id: sessionId,
            entryKey: entry.key,
            driverSession,
            datasource,
            mode,
        };
        this.activeSessions.set(sessionId, active);
        const self = this;
        return {
            id: sessionId,
            datasource,
            mode,
            async execute(sql, options) {
                return active.driverSession.execute(sql, options);
            },
            async cancel() {
                await active.driverSession.cancel();
            },
            async close() {
                await self.release({ id: sessionId });
            },
        };
    }
    async release(session) {
        const active = this.activeSessions.get(session.id);
        if (!active) {
            return;
        }
        this.activeSessions.delete(session.id);
        await active.driverSession.release();
    }
    async healthCheck(datasource) {
        const modes = [];
        modes.push(await this.healthCheckMode(datasource, "ro"));
        if (!this.config.enableMutations) {
            modes.push({
                mode: "rw",
                status: "skipped",
                message: "Mutation mode disabled by config.",
            });
        }
        else {
            modes.push(await this.healthCheckMode(datasource, "rw"));
        }
        return {
            datasource,
            checkedAt: new Date().toISOString(),
            modes,
        };
    }
    async close() {
        const activeSessions = [...this.activeSessions.values()];
        this.activeSessions.clear();
        for (const active of activeSessions) {
            try {
                await active.driverSession.release();
            }
            catch {
                // Ignore release failure during shutdown.
            }
        }
        const closers = [];
        for (const value of this.pools.values()) {
            const resolved = await value;
            closers.push(resolved.pool.close().catch(() => {
                // Ignore close failure during shutdown.
            }));
        }
        await Promise.all(closers);
        this.pools.clear();
    }
    async healthCheckMode(datasource, mode) {
        try {
            const session = await this.acquire(datasource, mode);
            await this.release(session);
            return { mode, status: "ok" };
        }
        catch (error) {
            if (mode === "rw" && error instanceof ConnectionPoolError && /not configured/.test(error.message)) {
                return { mode, status: "skipped", message: error.message };
            }
            return {
                mode,
                status: "error",
                message: error instanceof Error ? error.message : "unknown error",
            };
        }
    }
    async getOrCreatePool(profile, mode) {
        const key = poolKey(profile.name, mode);
        const existing = this.pools.get(key);
        if (existing) {
            return existing instanceof Promise ? existing : existing;
        }
        const pending = this.createPool(profile, mode)
            .then((entry) => {
            this.pools.set(key, entry);
            return entry;
        })
            .catch((error) => {
            this.pools.delete(key);
            throw error;
        });
        this.pools.set(key, pending);
        return pending;
    }
    async createPool(profile, mode) {
        const adapter = this.adapters[profile.engine];
        if (!adapter) {
            throw new ConnectionPoolError(`No driver adapter registered for engine "${profile.engine}".`);
        }
        const credential = selectCredential(profile, mode);
        const password = await resolveCredentialValue(credential.password, this.secretResolver, `${profile.name}.${mode}.password`);
        const tls = await resolveTls(profile.tls, this.secretResolver);
        let pool;
        try {
            pool = await adapter.createPool({
                datasource: profile.name,
                mode,
                engine: profile.engine,
                host: profile.host,
                port: profile.port,
                database: profile.database,
                username: credential.username,
                password,
                poolSize: profile.poolSize,
                tls,
            });
        }
        catch (error) {
            throw new ConnectionPoolError(`Failed to create ${mode === "ro" ? "readonly" : "mutation"} pool for datasource "${profile.name}".`, error);
        }
        return {
            key: poolKey(profile.name, mode),
            datasource: profile.name,
            mode,
            pool,
        };
    }
}
export function createConnectionPoolManager(options) {
    return new ConnectionPoolManager(options);
}
