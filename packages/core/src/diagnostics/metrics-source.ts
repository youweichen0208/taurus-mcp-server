import type { Config } from "../config/index.js";
import type { SessionContext } from "../context/session-context.js";
import type { DiagnosisWindow } from "./types.js";

export type MetricAlias =
  | "cpu_util"
  | "mem_util"
  | "connection_count"
  | "active_connection_count"
  | "connection_usage"
  | "qps"
  | "tps"
  | "slow_queries"
  | "replication_delay"
  | "storage_used_size"
  | "storage_write_delay"
  | "storage_read_delay"
  | "row_lock_time"
  | "row_lock_waits"
  | "long_trx_count"
  | "write_iops"
  | "read_iops"
  | "write_throughput"
  | "read_throughput"
  | "temp_tables_per_min";

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface MetricSummary {
  alias: MetricAlias;
  metricName: string;
  points: MetricPoint[];
  latest?: number;
  max?: number;
  min?: number;
  avg?: number;
}

export interface QueryMetricsInput {
  aliases: MetricAlias[];
  timeRange?: DiagnosisWindow;
}

export interface MetricsSource {
  query(
    input: QueryMetricsInput,
    ctx: SessionContext,
  ): Promise<MetricSummary[]>;
}

type CesMetricsSourceOptions = {
  endpoint: string;
  projectId: string;
  instanceId: string;
  nodeId?: string;
  authToken: string;
  namespace: string;
  instanceDimension: string;
  nodeDimension: string;
  period: string;
  filter: "average" | "max" | "min" | "sum" | "variance";
  requestTimeoutMs: number;
  defaultLookbackMinutes: number;
  fetchImpl?: typeof fetch;
};

const TAURUS_CES_METRICS: Record<MetricAlias, string> = {
  cpu_util: "gaussdb_mysql001_cpu_util",
  mem_util: "gaussdb_mysql002_mem_util",
  connection_count: "gaussdb_mysql006_conn_count",
  active_connection_count: "gaussdb_mysql007_conn_active_count",
  connection_usage: "gaussdb_mysql072_conn_usage",
  qps: "gaussdb_mysql008_qps",
  tps: "gaussdb_mysql009_tps",
  slow_queries: "gaussdb_mysql074_slow_queries",
  replication_delay: "gaussdb_mysql077_replication_delay",
  storage_used_size: "gaussdb_mysql048_disk_used_size",
  storage_write_delay: "gaussdb_mysql104_dfv_write_delay",
  storage_read_delay: "gaussdb_mysql105_dfv_read_delay",
  row_lock_time: "gaussdb_mysql121_innodb_row_lock_time",
  row_lock_waits: "gaussdb_mysql122_innodb_row_lock_waits",
  long_trx_count: "gaussdb_mysql128_long_trx_count",
  write_iops: "gaussdb_mysql342_iostat_iops_write",
  read_iops: "gaussdb_mysql344_iostat_iops_read",
  write_throughput: "gaussdb_mysql346_iostat_throughput_write",
  read_throughput: "gaussdb_mysql348_iostat_throughput_read",
  temp_tables_per_min: "gaussdb_mysql378_create_temp_tbl_per_min",
};

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseRelativeLookback(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) {
    return undefined;
  }
  const amount = Number.parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    case "d":
      return amount * 86_400_000;
    default:
      return undefined;
  }
}

function normalizeTimeRange(
  input: DiagnosisWindow | undefined,
  defaultLookbackMinutes: number,
): { from: number; to: number } {
  const now = Date.now();
  const to = input?.to ? Date.parse(input.to) : now;
  const safeTo = Number.isFinite(to) ? to : now;
  const relative = parseRelativeLookback(input?.relative);
  const from = input?.from
    ? Date.parse(input.from)
    : relative
      ? safeTo - relative
      : safeTo - defaultLookbackMinutes * 60_000;
  return {
    from: Number.isFinite(from)
      ? from
      : safeTo - defaultLookbackMinutes * 60_000,
    to: safeTo,
  };
}

function summarize(
  alias: MetricAlias,
  metricName: string,
  points: MetricPoint[],
): MetricSummary {
  const sorted = [...points].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const values = sorted.map((point) => point.value);
  return {
    alias,
    metricName,
    points: sorted,
    latest: values.at(-1),
    max: values.length > 0 ? Math.max(...values) : undefined,
    min: values.length > 0 ? Math.min(...values) : undefined,
    avg:
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : undefined,
  };
}

function parseMetricDataItem(item: Record<string, unknown>): MetricPoint[] {
  const rawDatapoints = item.datapoints ?? item.data_points ?? item.values;
  if (!Array.isArray(rawDatapoints)) {
    return [];
  }
  return rawDatapoints
    .map((entry): MetricPoint | undefined => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return undefined;
      }
      const record = entry as Record<string, unknown>;
      const timestamp = readNumber(
        record.timestamp ?? record.time ?? record.collect_time,
      );
      const value =
        readNumber(record.average) ??
        readNumber(record.max) ??
        readNumber(record.min) ??
        readNumber(record.sum) ??
        readNumber(record.value);
      if (timestamp === undefined || value === undefined) {
        return undefined;
      }
      return { timestamp, value };
    })
    .filter((point): point is MetricPoint => point !== undefined);
}

function pickMetricItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const candidates =
    record.metrics ?? record.metric_data ?? record.items ?? record.datapoints;
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export class CesMetricsSource implements MetricsSource {
  private readonly endpoint: string;
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly nodeId?: string;
  private readonly authToken: string;
  private readonly namespace: string;
  private readonly instanceDimension: string;
  private readonly nodeDimension: string;
  private readonly period: string;
  private readonly filter: "average" | "max" | "min" | "sum" | "variance";
  private readonly requestTimeoutMs: number;
  private readonly defaultLookbackMinutes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CesMetricsSourceOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/g, "");
    this.projectId = options.projectId;
    this.instanceId = options.instanceId;
    this.nodeId = options.nodeId;
    this.authToken = options.authToken;
    this.namespace = options.namespace;
    this.instanceDimension = options.instanceDimension;
    this.nodeDimension = options.nodeDimension;
    this.period = options.period;
    this.filter = options.filter;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.defaultLookbackMinutes = options.defaultLookbackMinutes;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async query(input: QueryMetricsInput): Promise<MetricSummary[]> {
    const uniqueAliases = [...new Set(input.aliases)];
    if (uniqueAliases.length === 0) {
      return [];
    }

    const timeRange = normalizeTimeRange(
      input.timeRange,
      this.defaultLookbackMinutes,
    );
    const path = `/V1.0/${this.projectId}/batch-query-metric-data`;
    const dimensions = [
      {
        name: this.instanceDimension,
        value: this.instanceId,
      },
    ];
    if (this.nodeId) {
      dimensions.push({
        name: this.nodeDimension,
        value: this.nodeId,
      });
    }
    const metricByName = new Map<string, MetricAlias>();
    for (const alias of uniqueAliases) {
      metricByName.set(TAURUS_CES_METRICS[alias], alias);
    }

    const payload = {
      namespace: this.namespace,
      metric_name: uniqueAliases.map((alias) => TAURUS_CES_METRICS[alias]),
      dimensions,
      from: timeRange.from,
      to: timeRange.to,
      period: this.period,
      filter: this.filter,
    };
    const body = await this.postJson(path, payload);
    return pickMetricItems(body)
      .map((item): MetricSummary | undefined => {
        const metricName =
          typeof item.metric_name === "string"
            ? item.metric_name
            : typeof item.metricName === "string"
              ? item.metricName
              : undefined;
        if (!metricName) {
          return undefined;
        }
        const alias = metricByName.get(metricName);
        if (!alias) {
          return undefined;
        }
        return summarize(alias, metricName, parseMetricDataItem(item));
      })
      .filter((item): item is MetricSummary => item !== undefined);
  }

  private async postJson(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-token": this.authToken,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {};
      }
      return parseResponse(response);
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createMetricsSource(config: Config): MetricsSource | undefined {
  const ces = config.metricsSource?.ces;
  if (
    !ces?.enabled ||
    !ces.endpoint ||
    !ces.projectId ||
    !ces.instanceId ||
    !ces.authToken
  ) {
    return undefined;
  }

  return new CesMetricsSource({
    endpoint: ces.endpoint,
    projectId: ces.projectId,
    instanceId: ces.instanceId,
    nodeId: ces.nodeId,
    authToken: ces.authToken,
    namespace: ces.namespace,
    instanceDimension: ces.instanceDimension,
    nodeDimension: ces.nodeDimension,
    period: ces.period,
    filter: ces.filter,
    requestTimeoutMs: ces.requestTimeoutMs,
    defaultLookbackMinutes: ces.defaultLookbackMinutes,
  });
}
