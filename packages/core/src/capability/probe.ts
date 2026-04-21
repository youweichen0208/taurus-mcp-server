import type { SessionContext } from "../context/session-context.js";
import type { ConnectionPool, Session } from "../executor/connection-pool.js";
import { buildFeatureMatrix } from "./feature-matrix.js";
import type { CapabilitySnapshot, FeatureMatrix, KernelInfo } from "./types.js";
import { extractKernelVersion } from "./version.js";

export interface CapabilityProbe {
  probe(ctx: SessionContext): Promise<CapabilitySnapshot>;
  getKernelInfo(ctx: SessionContext): Promise<KernelInfo>;
  listFeatures(ctx: SessionContext): Promise<FeatureMatrix>;
}

export interface CapabilityProbeOptions {
  connectionPool: ConnectionPool;
}

type ProbeVariables = Partial<Record<string, string>>;

function mysqlCompatFromVersion(rawVersion: string): KernelInfo["mysqlCompat"] {
  if (/8\.0/i.test(rawVersion)) {
    return "8.0";
  }
  if (/5\.7/i.test(rawVersion)) {
    return "5.7";
  }
  return "unknown";
}

function rowValueOf(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }

  const record = row as Record<string, unknown>;
  const preferredKeys = ["Value", "value", "VARIABLE_VALUE", "version", "VERSION()"];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function firstRow(result: { rows?: unknown[] }): unknown {
  return Array.isArray(result.rows) ? result.rows[0] : undefined;
}

function inferInstanceSpecHint(variables: ProbeVariables): KernelInfo["instanceSpecHint"] {
  const parallelSetting = (variables.force_parallel_execute ?? "").toUpperCase();
  const ndpMode = (
    variables.rds_ndp_mode ??
    variables.taurus_ndp_mode ??
    variables.ndp_pushdown_mode ??
    ""
  ).toUpperCase();

  if (parallelSetting === "ON" || ndpMode === "REPLICA_ON") {
    return "large";
  }
  if (parallelSetting === "OFF" || ndpMode === "ON") {
    return "medium";
  }
  return undefined;
}

async function executeSingleValueQuery(session: Session, sql: string): Promise<string | undefined> {
  try {
    const result = await session.execute(sql);
    return rowValueOf(firstRow(result));
  } catch {
    return undefined;
  }
}

async function readVariable(session: Session, name: string): Promise<string | undefined> {
  return executeSingleValueQuery(session, `SHOW VARIABLES LIKE '${name}'`);
}

async function collectVariables(session: Session): Promise<ProbeVariables> {
  const names = [
    "version_comment",
    "innodb_rds_backquery_enable",
    "force_parallel_execute",
    "optimizer_switch",
    "rds_ndp_mode",
    "taurus_ndp_mode",
    "ndp_pushdown_mode",
    "ndp_pushdown",
    "rds_multi_tenant",
    "multi_tenant_mode",
  ];

  const entries = await Promise.all(
    names.map(async (name) => [name, await readVariable(session, name)] as const),
  );

  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

async function detectKernelInfo(session: Session, variables: ProbeVariables): Promise<KernelInfo> {
  const rawVersion = (await executeSingleValueQuery(session, "SELECT VERSION() AS version")) ?? "unknown";
  const versionComment = variables.version_comment;
  const combined = [rawVersion, versionComment].filter(Boolean).join(" ");
  const kernelVersion = extractKernelVersion(combined);
  const taurusSignals = [combined, variables.force_parallel_execute, variables.innodb_rds_backquery_enable]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return {
    isTaurusDB: /taurus|huawei|gaussdb/i.test(taurusSignals),
    kernelVersion,
    mysqlCompat: mysqlCompatFromVersion(rawVersion),
    instanceSpecHint: inferInstanceSpecHint(variables),
    rawVersion,
  };
}

export class CapabilityProbeImpl implements CapabilityProbe {
  private readonly connectionPool: ConnectionPool;

  constructor(options: CapabilityProbeOptions) {
    this.connectionPool = options.connectionPool;
  }

  async probe(ctx: SessionContext): Promise<CapabilitySnapshot> {
    const session = await this.connectionPool.acquire(ctx.datasource, "ro");
    try {
      const variables = await collectVariables(session);
      const kernelInfo = await detectKernelInfo(session, variables);
      return {
        kernelInfo,
        features: buildFeatureMatrix(kernelInfo, variables),
        checkedAt: Date.now(),
      };
    } finally {
      await this.connectionPool.release(session);
    }
  }

  async getKernelInfo(ctx: SessionContext): Promise<KernelInfo> {
    const snapshot = await this.probe(ctx);
    return snapshot.kernelInfo;
  }

  async listFeatures(ctx: SessionContext): Promise<FeatureMatrix> {
    const snapshot = await this.probe(ctx);
    return snapshot.features;
  }
}

export function createCapabilityProbe(options: CapabilityProbeOptions): CapabilityProbe {
  return new CapabilityProbeImpl(options);
}
