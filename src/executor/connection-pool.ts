import { ulid } from "ulid";
import type { Config } from "../config/index.js";
import type {
  CredentialRef,
  DataSourceProfile,
  DatabaseEngine,
  ProfileLoader,
  TlsOptions,
} from "../auth/sql-profile-loader.js";
import type { SecretResolver } from "../auth/secret-resolver.js";

export type PoolMode = "ro" | "rw";

export interface ExecOptions {
  timeoutMs?: number;
}

export interface RawResult {
  rows?: unknown[];
  rowCount?: number;
  affectedRows?: number;
  fields?: Array<{ name: string; type?: string }>;
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

export class ConnectionPoolError extends Error {
  readonly code = "CONNECTION_FAILED";

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConnectionPoolError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

type InternalPoolEntry = {
  key: string;
  datasource: string;
  mode: PoolMode;
  pool: DriverPool;
};

type ActiveSession = {
  id: string;
  entryKey: string;
  driverSession: DriverSession;
  datasource: string;
  mode: PoolMode;
};

function poolKey(datasource: string, mode: PoolMode): string {
  return `${datasource}:${mode}`;
}

async function resolveTls(
  tls: TlsOptions | undefined,
  secretResolver: SecretResolver,
): Promise<DriverPoolCreateInput["tls"]> {
  if (!tls) {
    return undefined;
  }

  const resolved: DriverPoolCreateInput["tls"] = {
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

function ensureMutationAllowed(config: Config): void {
  if (!config.enableMutations) {
    throw new ConnectionPoolError("Mutation mode is disabled by configuration.");
  }
}

function selectCredential(profile: DataSourceProfile, mode: PoolMode) {
  if (mode === "ro") {
    return profile.readonlyUser;
  }
  if (!profile.mutationUser) {
    throw new ConnectionPoolError(
      `Mutation user is not configured for datasource "${profile.name}".`,
    );
  }
  return profile.mutationUser;
}

async function resolveCredentialValue(
  ref: CredentialRef,
  secretResolver: SecretResolver,
  context: string,
): Promise<string> {
  try {
    return await secretResolver.resolve(ref);
  } catch (error) {
    throw new ConnectionPoolError(`Failed to resolve credential for ${context}.`, error);
  }
}

export class ConnectionPoolManager implements ConnectionPool {
  private readonly config: Config;
  private readonly profileLoader: ProfileLoader;
  private readonly secretResolver: SecretResolver;
  private readonly adapters: Partial<Record<DatabaseEngine, DriverAdapter>>;
  private readonly pools = new Map<string, InternalPoolEntry | Promise<InternalPoolEntry>>();
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(options: ConnectionPoolManagerOptions) {
    this.config = options.config;
    this.profileLoader = options.profileLoader;
    this.secretResolver = options.secretResolver;
    this.adapters = options.adapters;
  }

  async acquire(datasource: string, mode: PoolMode): Promise<Session> {
    const profile = await this.profileLoader.get(datasource);
    if (!profile) {
      throw new ConnectionPoolError(`Datasource profile not found: "${datasource}".`);
    }

    if (mode === "rw") {
      ensureMutationAllowed(this.config);
    }

    const entry = await this.getOrCreatePool(profile, mode);
    let driverSession: DriverSession;
    try {
      driverSession = await entry.pool.acquire();
    } catch (error) {
      throw new ConnectionPoolError(
        `Failed to acquire database session for datasource "${datasource}".`,
        error,
      );
    }

    const sessionId = `sess_${ulid().toLowerCase()}`;
    const active: ActiveSession = {
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
      async execute(sql: string, options?: ExecOptions): Promise<RawResult> {
        return active.driverSession.execute(sql, options);
      },
      async cancel(): Promise<void> {
        await active.driverSession.cancel();
      },
      async close(): Promise<void> {
        await self.release({ id: sessionId } as Session);
      },
    };
  }

  async release(session: Session): Promise<void> {
    const active = this.activeSessions.get(session.id);
    if (!active) {
      return;
    }
    this.activeSessions.delete(session.id);
    await active.driverSession.release();
  }

  async healthCheck(datasource: string): Promise<PoolHealth> {
    const modes: ModeHealth[] = [];

    modes.push(await this.healthCheckMode(datasource, "ro"));

    if (!this.config.enableMutations) {
      modes.push({
        mode: "rw",
        status: "skipped",
        message: "Mutation mode disabled by config.",
      });
    } else {
      modes.push(await this.healthCheckMode(datasource, "rw"));
    }

    return {
      datasource,
      checkedAt: new Date().toISOString(),
      modes,
    };
  }

  async close(): Promise<void> {
    const activeSessions = [...this.activeSessions.values()];
    this.activeSessions.clear();

    for (const active of activeSessions) {
      try {
        await active.driverSession.release();
      } catch {
        // Ignore release failure during shutdown.
      }
    }

    const closers: Promise<void>[] = [];
    for (const value of this.pools.values()) {
      const resolved = await value;
      closers.push(
        resolved.pool.close().catch(() => {
          // Ignore close failure during shutdown.
        }),
      );
    }
    await Promise.all(closers);
    this.pools.clear();
  }

  private async healthCheckMode(datasource: string, mode: PoolMode): Promise<ModeHealth> {
    try {
      const session = await this.acquire(datasource, mode);
      await this.release(session);
      return { mode, status: "ok" };
    } catch (error) {
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

  private async getOrCreatePool(
    profile: DataSourceProfile,
    mode: PoolMode,
  ): Promise<InternalPoolEntry> {
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

  private async createPool(profile: DataSourceProfile, mode: PoolMode): Promise<InternalPoolEntry> {
    const adapter = this.adapters[profile.engine];
    if (!adapter) {
      throw new ConnectionPoolError(`No driver adapter registered for engine "${profile.engine}".`);
    }

    const credential = selectCredential(profile, mode);
    const password = await resolveCredentialValue(
      credential.password,
      this.secretResolver,
      `${profile.name}.${mode}.password`,
    );
    const tls = await resolveTls(profile.tls, this.secretResolver);

    let pool: DriverPool;
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
    } catch (error) {
      throw new ConnectionPoolError(
        `Failed to create ${mode === "ro" ? "readonly" : "mutation"} pool for datasource "${profile.name}".`,
        error,
      );
    }

    return {
      key: poolKey(profile.name, mode),
      datasource: profile.name,
      mode,
      pool,
    };
  }
}

export function createConnectionPoolManager(
  options: ConnectionPoolManagerOptions,
): ConnectionPoolManager {
  return new ConnectionPoolManager(options);
}
