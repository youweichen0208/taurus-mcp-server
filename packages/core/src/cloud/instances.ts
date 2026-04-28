import type { Config } from "../config/index.js";
import {
  fetchHuaweiCloud,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
  type HuaweiCloudAuthOptions,
} from "./auth.js";

export interface ListCloudTaurusInstancesInput {
  name?: string;
  id?: string;
  ip?: string;
  offset?: number;
  limit?: number;
}

export interface CloudTaurusInstanceSummary {
  id: string;
  name: string;
  status?: string;
  mode?: string;
  region?: string;
  datastoreVersion?: string;
  vpcId?: string;
  subnetId?: string;
  privateIps: string[];
  publicIps: string[];
  hostnames: string[];
  port?: string;
  nodeIds: string[];
  primaryNodeId?: string;
  created?: string;
  updated?: string;
}

type CloudInstanceClientOptions = {
  endpoint: string;
  auth: HuaweiCloudAuthOptions;
  language: "en-us" | "zh-cn";
  fetchImpl?: typeof fetch;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readString(item))
    .filter((item): item is string => item !== undefined);
}

function readNestedAddressList(
  value: unknown,
  key: string,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      return readString((item as Record<string, unknown>)[key]);
    })
    .filter((item): item is string => item !== undefined);
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function buildQueryString(input: ListCloudTaurusInstancesInput): string {
  const params = new URLSearchParams();
  const offset = clampInteger(input.offset, 0, 0, 10_000);
  const limit = clampInteger(input.limit, 50, 1, 100);

  params.set("offset", String(offset));
  params.set("limit", String(limit));

  const name = readString(input.name);
  if (name) {
    params.set("name", name);
  }
  const id = readString(input.id);
  if (id) {
    params.set("id", id);
  }
  const ip = readString(input.ip);
  if (ip) {
    params.set("ip", ip);
  }

  return params.toString();
}

function parseInstanceSummary(
  item: Record<string, unknown>,
): CloudTaurusInstanceSummary | undefined {
  const id = readString(item.id);
  const name = readString(item.name);
  if (!id || !name) {
    return undefined;
  }

  const nodes = Array.isArray(item.nodes)
    ? item.nodes.filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const nodeIds = nodes
    .map((entry) => readString(entry.id) ?? readString(entry.node_id))
    .filter((entry): entry is string => entry !== undefined);
  const primaryNode =
    nodes.find((entry) => {
      const role =
        readString(entry.role) ??
        readString(entry.type) ??
        readString(entry.node_type);
      return Boolean(role && /(master|primary|writer|readwrite)/i.test(role));
    }) ?? (nodes.length === 1 ? nodes[0] : undefined);

  const port = readString(item.port) ?? readString(item.db_port);
  return {
    id,
    name,
    status: readString(item.status),
    mode: readString(item.mode),
    region: readString(item.region),
    datastoreVersion:
      readString((item.datastore as Record<string, unknown> | undefined)?.version) ??
      readString(item.db_type),
    vpcId:
      readString((item.vpc_security_group as Record<string, unknown> | undefined)?.vpc_id) ??
      readString(item.vpc_id),
    subnetId:
      readString((item.vpc_security_group as Record<string, unknown> | undefined)?.subnet_id) ??
      readString(item.subnet_id),
    privateIps: [
      ...readStringList(item.private_ips),
      ...readStringList(item.proxy_ips),
      ...readStringList(item.readonly_private_ips),
      ...readNestedAddressList(item.nodes, "private_ip"),
    ].filter((value, index, allItems) => allItems.indexOf(value) === index),
    publicIps: readStringList(item.public_ips),
    hostnames: [
      readString(item.private_dns),
      readString(item.public_dns),
      readString(item.db_domain),
      readString(item.readonly_domain),
      readString(item.alias),
    ].filter((value, index, allItems): value is string =>
      value !== undefined && allItems.indexOf(value) === index,
    ),
    port,
    nodeIds,
    primaryNodeId:
      readString(primaryNode?.id) ??
      readString(primaryNode?.node_id) ??
      (nodeIds.length === 1 ? nodeIds[0] : undefined),
    created: readString(item.created),
    updated: readString(item.updated),
  };
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function normalizePort(port: string | number | undefined): string | undefined {
  if (typeof port === "number" && Number.isFinite(port)) {
    return String(port);
  }
  return readString(typeof port === "string" ? port : undefined);
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export class CloudTaurusInstanceClient {
  private readonly endpoint: string;
  private readonly auth: HuaweiCloudAuthOptions;
  private readonly language: "en-us" | "zh-cn";
  private readonly fetchImpl: typeof fetch;
  private resolvedProjectId?: string;

  constructor(options: CloudInstanceClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/g, "");
    this.auth = options.auth;
    this.language = options.language;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolvedProjectId = readString(options.auth.projectId);
  }

  async getProjectId(): Promise<string> {
    if (!this.resolvedProjectId) {
      this.resolvedProjectId = await resolveHuaweiCloudProjectId(
        this.auth,
        this.fetchImpl,
      );
    }
    if (!this.resolvedProjectId) {
      throw new Error(
        "Cloud instance discovery could not resolve a Huawei Cloud project id. Provide TAURUSDB_CLOUD_PROJECT_ID or configure region plus AK/SK credentials.",
      );
    }
    return this.resolvedProjectId;
  }

  async list(
    input: ListCloudTaurusInstancesInput = {},
  ): Promise<CloudTaurusInstanceSummary[]> {
    const query = buildQueryString(input);
    const projectId = await this.getProjectId();
    const response = await fetchHuaweiCloud({
      url: `${this.endpoint}/v3/${projectId}/instances?${query}`,
      headers: {
        "content-type": "application/json",
        "x-language": this.language,
      },
      auth: this.auth,
      fetchImpl: this.fetchImpl,
    });

    if (!response.ok) {
      const payload = (await parseJsonObject(response).catch(
        () => ({} as Record<string, unknown>),
      )) as Record<string, unknown>;
      const code = readString(payload.error_code) ?? readString(payload.code);
      const message = readString(payload.error_msg) ?? readString(payload.message);
      throw new Error(
        `Cloud instance list request failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`,
      );
    }

    const payload = await parseJsonObject(response);
    const instances = Array.isArray(payload.instances)
      ? payload.instances
      : Array.isArray(payload.instance_info)
        ? payload.instance_info
        : [];

    return instances
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? parseInstanceSummary(item as Record<string, unknown>)
          : undefined,
      )
      .filter((item): item is CloudTaurusInstanceSummary => item !== undefined);
  }

  async resolveByHostPort(
    host: string,
    port?: string | number,
  ): Promise<CloudTaurusInstanceSummary> {
    const normalizedHost = normalizeHost(host);
    const normalizedPort = normalizePort(port);
    const instances = await this.list({
      ip: normalizedHost,
      limit: 100,
    });

    const matches = instances.filter((item) => {
      const hosts = [
        ...item.privateIps,
        ...item.publicIps,
        ...item.hostnames,
      ].map(normalizeHost);
      if (!hosts.includes(normalizedHost)) {
        return false;
      }
      if (!normalizedPort || !item.port) {
        return true;
      }
      return item.port === normalizedPort;
    });

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length === 0) {
      throw new Error(
        `No cloud instance matched datasource address ${host}${normalizedPort ? `:${normalizedPort}` : ""}. Use list_cloud_taurus_instances and provide an explicit instance id.`,
      );
    }
    throw new Error(
      `Multiple cloud instances matched datasource address ${host}${normalizedPort ? `:${normalizedPort}` : ""}. Use list_cloud_taurus_instances and select an explicit instance id.`,
    );
  }
}

export function createCloudTaurusInstanceClient(
  config: Config,
): CloudTaurusInstanceClient | undefined {
  const endpoint =
    config.cloud?.apiEndpoint ??
    config.slowSqlSource?.taurusApi?.endpoint ??
    config.metricsSource?.ces?.endpoint;
  const language = config.cloud?.language ?? "zh-cn";

  if (!endpoint) {
    return undefined;
  }

  return new CloudTaurusInstanceClient({
    endpoint,
    auth: {
      ...getHuaweiCloudAuthFromConfig(config),
      projectId:
        config.cloud?.projectId ??
        config.slowSqlSource?.taurusApi?.projectId ??
        config.metricsSource?.ces?.projectId,
      authToken:
        config.cloud?.authToken ??
        config.slowSqlSource?.taurusApi?.authToken ??
        config.metricsSource?.ces?.authToken,
    },
    language,
  });
}
