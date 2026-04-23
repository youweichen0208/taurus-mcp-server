import type { Config } from "../config/index.js";
import type { DiagnoseSlowQueryInput, DiagnosisWindow } from "./types.js";
import type { SessionContext } from "../context/session-context.js";
import { normalizeSql, sqlHash } from "../utils/hash.js";

export interface ResolveSlowSqlInput {
  sqlHash?: string;
  digestText?: string;
  timeRange?: DiagnosisWindow;
}

export interface ExternalSlowSqlSample {
  source: string;
  sql: string;
  sqlHash: string;
  digestText?: string;
  database?: string;
  user?: string;
  clientIp?: string;
  startTime?: string;
  execCount?: number;
  avgLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  rowsSent?: number;
  rawRef?: string;
}

export interface SlowSqlSource {
  resolve(input: ResolveSlowSqlInput, ctx: SessionContext): Promise<ExternalSlowSqlSample | undefined>;
}

type TaurusApiCandidate = {
  sql?: string;
  database?: string;
  user?: string;
  clientIp?: string;
  startTime?: string;
  execCount?: number;
  avgLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  rowsSent?: number;
  rawRef?: string;
};

type TaurusApiSlowSqlSourceOptions = {
  endpoint: string;
  projectId: string;
  instanceId: string;
  nodeId: string;
  authToken: string;
  language: "en-us" | "zh-cn";
  requestTimeoutMs: number;
  defaultLookbackMinutes: number;
  maxRecords: number;
  fetchImpl?: typeof fetch;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseFloat(value)
      : undefined;
}

function normalizeTimeRange(
  input: DiagnosisWindow | undefined,
  defaultLookbackMinutes: number,
): { startTime: string; endTime: string } {
  const now = new Date();
  const end = input?.to ? new Date(input.to) : now;
  const parsedRelative = parseRelativeLookback(input?.relative);
  const start =
    input?.from
      ? new Date(input.from)
      : parsedRelative
        ? new Date(end.getTime() - parsedRelative)
        : new Date(end.getTime() - defaultLookbackMinutes * 60_000);
  return {
    startTime: formatTaurusApiTime(start),
    endTime: formatTaurusApiTime(end),
  };
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
  const unit = match[2].toLowerCase();
  switch (unit) {
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

function formatTaurusApiTime(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

function formatDigestTemplate(sql: string): string {
  const withoutStrings = sql.replace(/'(?:''|[^'])*'|"(?:[""]|[^"])*"/g, "?");
  const withoutNumbers = withoutStrings.replace(/\b\d+(?:\.\d+)?\b/g, "?");
  return normalizeSql(withoutNumbers);
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().match(/^([\d.]+)\s*(ms|s|us|µs)?$/i);
  if (!match) {
    return undefined;
  }
  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "s":
      return amount * 1000;
    case "us":
    case "µs":
      return amount / 1000;
    default:
      return amount;
  }
}

function pickArrayCandidate(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  for (const key of [
    "slow_log_list",
    "slow_log_statistics",
    "slow_log_statistic_list",
    "items",
    "records",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      );
    }
  }
  return [];
}

function parseStatisticsCandidate(item: Record<string, unknown>, rawRef: string): TaurusApiCandidate | undefined {
  const sql = readString(item.query_sample) ?? readString(item.sql_statement);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database: readString(item.database),
    user: readString(item.users) ?? readString(item.user),
    clientIp: readString(item.client_ip),
    startTime: readString(item.start_at) ?? readString(item.time),
    execCount: readNumber(item.count),
    avgLatencyMs: parseDurationMs(item.execute_time) ?? parseDurationMs(item.avg_query_time),
    avgLockTimeMs: parseDurationMs(item.lock_time),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

function parseDetailCandidate(item: Record<string, unknown>, rawRef: string): TaurusApiCandidate | undefined {
  const sql = readString(item.query_sample) ?? readString(item.sql_statement);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database: readString(item.database),
    user: readString(item.user),
    clientIp: readString(item.client_ip),
    startTime: readString(item.start_at) ?? readString(item.time),
    execCount: 1,
    avgLatencyMs: parseDurationMs(item.query_time) ?? parseDurationMs(item.execute_time),
    avgLockTimeMs: parseDurationMs(item.lock_time),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

function scoreCandidate(
  candidate: TaurusApiCandidate,
  input: ResolveSlowSqlInput,
): number {
  if (!candidate.sql) {
    return -1;
  }
  const candidateHash = sqlHash(normalizeSql(candidate.sql));
  const candidateDigest = formatDigestTemplate(candidate.sql);
  let score = 0;
  if (input.sqlHash && input.sqlHash === candidateHash) {
    score += 100;
  }
  if (input.digestText && formatDigestTemplate(input.digestText) === candidateDigest) {
    score += 90;
  }
  if (candidate.avgLatencyMs !== undefined) {
    score += Math.min(candidate.avgLatencyMs / 100, 20);
  }
  return score;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export class TaurusApiSlowSqlSource implements SlowSqlSource {
  private readonly endpoint: string;
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly nodeId: string;
  private readonly authToken: string;
  private readonly language: "en-us" | "zh-cn";
  private readonly requestTimeoutMs: number;
  private readonly defaultLookbackMinutes: number;
  private readonly maxRecords: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TaurusApiSlowSqlSourceOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/g, "");
    this.projectId = options.projectId;
    this.instanceId = options.instanceId;
    this.nodeId = options.nodeId;
    this.authToken = options.authToken;
    this.language = options.language;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.defaultLookbackMinutes = options.defaultLookbackMinutes;
    this.maxRecords = options.maxRecords;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolve(input: ResolveSlowSqlInput, ctx: SessionContext): Promise<ExternalSlowSqlSample | undefined> {
    const timeWindow = normalizeTimeRange(input.timeRange, this.defaultLookbackMinutes);
    const statisticCandidates = await this.fetchStatistics(timeWindow, ctx.database);
    const matchedStatistic = this.pickBestMatch(statisticCandidates, input);
    if (matchedStatistic) {
      return this.toExternalSample(matchedStatistic, input);
    }

    const detailCandidates = await this.fetchDetails(timeWindow, ctx.database);
    const matchedDetail = this.pickBestMatch(detailCandidates, input);
    if (matchedDetail) {
      return this.toExternalSample(matchedDetail, input);
    }

    return undefined;
  }

  private async fetchStatistics(
    timeWindow: { startTime: string; endTime: string },
    database: string | undefined,
  ): Promise<TaurusApiCandidate[]> {
    const path = `/v3/${this.projectId}/instances/${this.instanceId}/slow-logs/statistics`;
    const payload: Record<string, unknown> = {
      node_id: this.nodeId,
      start_time: timeWindow.startTime,
      end_time: timeWindow.endTime,
      limit: this.maxRecords,
      sort: "execute_time",
      order: "desc",
    };
    if (database) {
      payload.database = database;
    }
    const body = await this.postJson(path, payload);
    return pickArrayCandidate(body)
      .map((item) => parseStatisticsCandidate(item, `taurus_api:${path}`))
      .filter((value): value is TaurusApiCandidate => value !== undefined);
  }

  private async fetchDetails(
    timeWindow: { startTime: string; endTime: string },
    database: string | undefined,
  ): Promise<TaurusApiCandidate[]> {
    const path = `/v3.1/${this.projectId}/instances/${this.instanceId}/slow-logs`;
    const payload: Record<string, unknown> = {
      node_id: this.nodeId,
      start_time: timeWindow.startTime,
      end_time: timeWindow.endTime,
      offset: 0,
      limit: this.maxRecords,
    };
    if (database) {
      payload.database = database;
    }
    const body = await this.postJson(path, payload);
    return pickArrayCandidate(body)
      .map((item) => parseDetailCandidate(item, `taurus_api:${path}`))
      .filter((value): value is TaurusApiCandidate => value !== undefined);
  }

  private pickBestMatch(
    candidates: TaurusApiCandidate[],
    input: ResolveSlowSqlInput,
  ): TaurusApiCandidate | undefined {
    const scored = candidates
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate, input) }))
      .sort((left, right) => right.score - left.score);
    if (scored.length === 0) {
      return undefined;
    }
    if (input.sqlHash || input.digestText) {
      return scored[0].score > 0 ? scored[0].candidate : undefined;
    }
    return scored[0].candidate;
  }

  private toExternalSample(
    candidate: TaurusApiCandidate,
    input: ResolveSlowSqlInput,
  ): ExternalSlowSqlSample | undefined {
    if (!candidate.sql) {
      return undefined;
    }
    return {
      source: "taurus_api_slow_logs",
      sql: candidate.sql,
      sqlHash: input.sqlHash ?? sqlHash(normalizeSql(candidate.sql)),
      digestText: input.digestText,
      database: candidate.database,
      user: candidate.user,
      clientIp: candidate.clientIp,
      startTime: candidate.startTime,
      execCount: candidate.execCount,
      avgLatencyMs: candidate.avgLatencyMs,
      avgLockTimeMs: candidate.avgLockTimeMs,
      avgRowsExamined: candidate.avgRowsExamined,
      rowsSent: candidate.rowsSent,
      rawRef: candidate.rawRef,
    };
  }

  private async postJson(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-token": this.authToken,
          "x-language": this.language,
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

export function createSlowSqlSource(config: Config): SlowSqlSource | undefined {
  const taurusApi = config.slowSqlSource?.taurusApi;
  if (
    !taurusApi?.enabled ||
    !taurusApi.endpoint ||
    !taurusApi.projectId ||
    !taurusApi.instanceId ||
    !taurusApi.nodeId ||
    !taurusApi.authToken
  ) {
    return undefined;
  }

  return new TaurusApiSlowSqlSource({
    endpoint: taurusApi.endpoint,
    projectId: taurusApi.projectId,
    instanceId: taurusApi.instanceId,
    nodeId: taurusApi.nodeId,
    authToken: taurusApi.authToken,
    language: taurusApi.language,
    requestTimeoutMs: taurusApi.requestTimeoutMs,
    defaultLookbackMinutes: taurusApi.defaultLookbackMinutes,
    maxRecords: taurusApi.maxRecords,
  });
}

export function buildResolveSlowSqlInput(
  input: DiagnoseSlowQueryInput,
): ResolveSlowSqlInput {
  return {
    sqlHash: input.sqlHash,
    digestText: input.digestText,
    timeRange: input.timeRange,
  };
}
