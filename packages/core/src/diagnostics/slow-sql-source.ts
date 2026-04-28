import type { Config } from "../config/index.js";
import type {
  DiagnoseSlowQueryInput,
  DiagnosisWindow,
  FindTopSlowSqlInput,
} from "./types.js";
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
  findTop?(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample[]>;
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

type DasSlowSqlSourceOptions = {
  endpoint: string;
  projectId: string;
  instanceId: string;
  authToken: string;
  datastoreType: "MySQL" | "TaurusDB";
  requestTimeoutMs: number;
  defaultLookbackMinutes: number;
  maxRecords: number;
  maxPages: number;
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

function formatUnixSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000));
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

function secondsToMs(value: unknown): number | undefined {
  const parsed = readNumber(value);
  return parsed === undefined ? undefined : parsed * 1000;
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

function candidateToExternalSample(
  candidate: TaurusApiCandidate,
  source: string,
): ExternalSlowSqlSample | undefined {
  if (!candidate.sql) {
    return undefined;
  }
  return {
    source,
    sql: candidate.sql,
    sqlHash: sqlHash(normalizeSql(candidate.sql)),
    digestText: formatDigestTemplate(candidate.sql),
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

function sortExternalSamples(
  samples: ExternalSlowSqlSample[],
  sortBy: FindTopSlowSqlInput["sortBy"],
): ExternalSlowSqlSample[] {
  return [...samples].sort((left, right) => {
    const leftExecCount = left.execCount ?? 0;
    const rightExecCount = right.execCount ?? 0;
    const leftAvgLatency = left.avgLatencyMs ?? 0;
    const rightAvgLatency = right.avgLatencyMs ?? 0;
    const leftTotalLatency = leftAvgLatency * Math.max(leftExecCount, 1);
    const rightTotalLatency = rightAvgLatency * Math.max(rightExecCount, 1);
    const leftLockTime = left.avgLockTimeMs ?? 0;
    const rightLockTime = right.avgLockTimeMs ?? 0;

    switch (sortBy) {
      case "avg_latency":
        return (
          rightAvgLatency - leftAvgLatency ||
          rightTotalLatency - leftTotalLatency ||
          rightExecCount - leftExecCount
        );
      case "exec_count":
        return (
          rightExecCount - leftExecCount ||
          rightTotalLatency - leftTotalLatency ||
          rightAvgLatency - leftAvgLatency
        );
      case "lock_time":
        return (
          rightLockTime - leftLockTime ||
          rightTotalLatency - leftTotalLatency ||
          rightExecCount - leftExecCount
        );
      default:
        return (
          rightTotalLatency - leftTotalLatency ||
          rightAvgLatency - leftAvgLatency ||
          rightExecCount - leftExecCount
        );
    }
  });
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  return new URLSearchParams(
    entries.map(([key, value]) => [key, String(value)]),
  ).toString();
}

function pickNextMarker(payload: Record<string, unknown>): string | undefined {
  return readString(
    payload.next_marker ??
      payload.nextMarker ??
      payload.marker ??
      payload.offset,
  );
}

function parseDasSlowLogCandidate(
  item: Record<string, unknown>,
  rawRef: string,
): TaurusApiCandidate | undefined {
  const sql =
    readString(item.sql) ??
    readString(item.query) ??
    readString(item.sql_statement) ??
    readString(item.template);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database:
      readString(item.database) ??
      readString(item.db_name) ??
      readString(item.databases),
    user: readString(item.users) ?? readString(item.user),
    clientIp: readString(item.client_ip),
    startTime:
      readString(item.start_at) ??
      readString(item.time) ??
      readString(item.timestamp),
    execCount: readNumber(item.count) ?? 1,
    avgLatencyMs:
      secondsToMs(item.query_time) ??
      parseDurationMs(item.query_time_ms) ??
      secondsToMs(item.avg_query_time),
    avgLockTimeMs:
      secondsToMs(item.lock_time) ?? parseDurationMs(item.lock_time_ms),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

function parseDasSqlStatementCandidate(
  item: Record<string, unknown>,
  rawRef: string,
): TaurusApiCandidate | undefined {
  const sql =
    readString(item.sql) ??
    readString(item.sql_statement) ??
    readString(item.query);
  if (!sql) {
    return undefined;
  }
  return {
    sql,
    database:
      readString(item.database) ??
      readString(item.db_name) ??
      readString(item.schema_name),
    user: readString(item.user) ?? readString(item.users),
    clientIp: readString(item.client_ip),
    startTime:
      readString(item.start_at) ??
      readString(item.time) ??
      readString(item.timestamp),
    execCount: 1,
    avgLatencyMs:
      parseDurationMs(item.query_time) ??
      secondsToMs(item.query_time_second) ??
      parseDurationMs(item.duration),
    avgLockTimeMs:
      parseDurationMs(item.lock_time) ?? secondsToMs(item.lock_time_second),
    avgRowsExamined: readNumber(item.rows_examined),
    rowsSent: readNumber(item.rows_sent),
    rawRef,
  };
}

function pickDasTopSlowArrays(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const arrays = [
    payload.top_execute_slow_logs,
    payload.top_avg_query_time_slow_logs,
    payload.top_max_query_time_slow_logs,
    payload.top_returned_rows_slow_logs,
    payload.top_rows_examined_slow_logs,
  ];
  return arrays.flatMap((value) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === "object" && !Array.isArray(item),
        )
      : [],
  );
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

  async findTop(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample[]> {
    const timeWindow = normalizeTimeRange(
      input.timeRange,
      this.defaultLookbackMinutes,
    );
    const statisticCandidates = await this.fetchStatistics(
      timeWindow,
      ctx.database,
    );
    const samples = statisticCandidates
      .map((candidate) =>
        candidateToExternalSample(candidate, "taurus_api_slow_logs"),
      )
      .filter((value): value is ExternalSlowSqlSample => value !== undefined);
    return sortExternalSamples(samples, input.sortBy).slice(
      0,
      Math.min(input.topN ?? 5, this.maxRecords),
    );
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
    const sample = candidateToExternalSample(candidate, "taurus_api_slow_logs");
    if (!sample) {
      return undefined;
    }
    return {
      ...sample,
      sqlHash: input.sqlHash ?? sample.sqlHash,
      digestText: input.digestText ?? sample.digestText,
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

export class DasSlowSqlSource implements SlowSqlSource {
  private readonly endpoint: string;
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly authToken: string;
  private readonly datastoreType: "MySQL" | "TaurusDB";
  private readonly requestTimeoutMs: number;
  private readonly defaultLookbackMinutes: number;
  private readonly maxRecords: number;
  private readonly maxPages: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DasSlowSqlSourceOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/g, "");
    this.projectId = options.projectId;
    this.instanceId = options.instanceId;
    this.authToken = options.authToken;
    this.datastoreType = options.datastoreType;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.defaultLookbackMinutes = options.defaultLookbackMinutes;
    this.maxRecords = options.maxRecords;
    this.maxPages = options.maxPages;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolve(
    input: ResolveSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample | undefined> {
    const timeWindow = normalizeTimeRange(
      input.timeRange,
      this.defaultLookbackMinutes,
    );
    const slowLogCandidates = await this.fetchSlowQueryLogs(timeWindow, ctx);
    const matchedSlowLog = this.pickBestMatch(slowLogCandidates, input);
    if (matchedSlowLog) {
      return this.toExternalSample(matchedSlowLog, input, "das_slow_query_logs");
    }

    const fullSqlCandidates = await this.fetchSqlStatements(timeWindow, ctx);
    const matchedFullSql = this.pickBestMatch(fullSqlCandidates, input);
    if (matchedFullSql) {
      return this.toExternalSample(matchedFullSql, input, "das_sql_statements");
    }

    return undefined;
  }

  async findTop(
    input: FindTopSlowSqlInput,
    _ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample[]> {
    const payload = await this.getJson(
      `/v3/${this.projectId}/instances/${this.instanceId}/top-slow-log`,
      {
        datastore_type: this.datastoreType,
        num: Math.min(input.topN ?? 5, this.maxRecords),
      },
    );
    const samples = pickDasTopSlowArrays(payload)
      .map((item) =>
        candidateToExternalSample(
          {
            sql:
              readString(item.template) ??
              readString(item.sql) ??
              readString(item.sql_statement),
            database: readString(item.databases) ?? readString(item.database),
            user: readString(item.users) ?? readString(item.user),
            execCount: readNumber(item.times) ?? readNumber(item.count),
            avgLatencyMs:
              secondsToMs(item.avg_query_time) ??
              secondsToMs(item.query_time),
            avgLockTimeMs: secondsToMs(item.avg_lock_time),
            avgRowsExamined: readNumber(item.rows_examined),
            rowsSent: readNumber(item.rows_sent),
            rawRef: `das:/v3/${this.projectId}/instances/${this.instanceId}/top-slow-log`,
          },
          "das_top_slow_log",
        ),
      )
      .filter((value): value is ExternalSlowSqlSample => value !== undefined);
    return sortExternalSamples(samples, input.sortBy).slice(
      0,
      Math.min(input.topN ?? 5, this.maxRecords),
    );
  }

  private async fetchSlowQueryLogs(
    timeWindow: { startTime: string; endTime: string },
    ctx: SessionContext,
  ): Promise<TaurusApiCandidate[]> {
    return this.collectPagedCandidates(
      "/slow-query-logs",
      timeWindow,
      ctx,
      "slow_logs",
      parseDasSlowLogCandidate,
    );
  }

  private async fetchSqlStatements(
    timeWindow: { startTime: string; endTime: string },
    ctx: SessionContext,
  ): Promise<TaurusApiCandidate[]> {
    return this.collectPagedCandidates(
      "/sql-statements",
      timeWindow,
      ctx,
      "sql_statements",
      parseDasSqlStatementCandidate,
    );
  }

  private async collectPagedCandidates(
    suffix: string,
    timeWindow: { startTime: string; endTime: string },
    ctx: SessionContext,
    arrayKey: string,
    parser: (
      item: Record<string, unknown>,
      rawRef: string,
    ) => TaurusApiCandidate | undefined,
  ): Promise<TaurusApiCandidate[]> {
    const output: TaurusApiCandidate[] = [];
    let marker: string | undefined;

    for (let page = 0; page < this.maxPages; page += 1) {
      const path = `/v3/${this.projectId}/instances/${this.instanceId}${suffix}`;
      const payload = await this.getJson(path, {
        datastore_type: this.datastoreType,
        start_at: formatUnixSeconds(new Date(timeWindow.startTime)),
        end_at: formatUnixSeconds(new Date(timeWindow.endTime)),
        limit: this.maxRecords,
        marker,
      });
      const items = Array.isArray(payload[arrayKey])
        ? payload[arrayKey].filter(
            (item): item is Record<string, unknown> =>
              item !== null && typeof item === "object" && !Array.isArray(item),
          )
        : [];
      for (const item of items) {
        const candidate = parser(item, `das:${path}`);
        if (!candidate) {
          continue;
        }
        if (
          ctx.database &&
          candidate.database &&
          candidate.database !== ctx.database
        ) {
          continue;
        }
        output.push(candidate);
      }
      marker = pickNextMarker(payload);
      if (!marker || items.length === 0 || output.length >= this.maxRecords) {
        break;
      }
    }

    return output.slice(0, this.maxRecords);
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
    source: string,
  ): ExternalSlowSqlSample | undefined {
    const sample = candidateToExternalSample(candidate, source);
    if (!sample) {
      return undefined;
    }
    return {
      ...sample,
      sqlHash: input.sqlHash ?? sample.sqlHash,
      digestText: input.digestText ?? sample.digestText,
    };
  }

  private async getJson(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<Record<string, unknown>> {
    const queryString = buildQueryString(params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.endpoint}${path}${queryString ? `?${queryString}` : ""}`,
        {
          method: "GET",
          headers: {
            "content-type": "application/json",
            "x-auth-token": this.authToken,
          },
          signal: controller.signal,
        },
      );
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

class CompositeSlowSqlSource implements SlowSqlSource {
  constructor(private readonly sources: SlowSqlSource[]) {}

  async resolve(
    input: ResolveSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample | undefined> {
    for (const source of this.sources) {
      const resolved = await source.resolve(input, ctx);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  async findTop(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample[]> {
    const allSamples = (
      await Promise.all(
        this.sources.map((source) =>
          source.findTop ? source.findTop(input, ctx) : [],
        ),
      )
    ).flat();
    const deduped = allSamples.filter((sample, index, allItems) => {
      const key = `${sample.source}:${sample.sqlHash}:${sample.digestText ?? ""}:${sample.sql}`;
      return (
        allItems.findIndex((candidate) => {
          const candidateKey = `${candidate.source}:${candidate.sqlHash}:${candidate.digestText ?? ""}:${candidate.sql}`;
          return candidateKey === key;
        }) === index
      );
    });
    return sortExternalSamples(deduped, input.sortBy).slice(
      0,
      Math.min(input.topN ?? 5, deduped.length),
    );
  }
}

export function createSlowSqlSource(config: Config): SlowSqlSource | undefined {
  const sources: SlowSqlSource[] = [];
  const taurusApi = config.slowSqlSource?.taurusApi;
  if (
    taurusApi?.enabled &&
    taurusApi.endpoint &&
    taurusApi.projectId &&
    taurusApi.instanceId &&
    taurusApi.nodeId &&
    taurusApi.authToken
  ) {
    sources.push(
      new TaurusApiSlowSqlSource({
        endpoint: taurusApi.endpoint,
        projectId: taurusApi.projectId,
        instanceId: taurusApi.instanceId,
        nodeId: taurusApi.nodeId,
        authToken: taurusApi.authToken,
        language: taurusApi.language,
        requestTimeoutMs: taurusApi.requestTimeoutMs,
        defaultLookbackMinutes: taurusApi.defaultLookbackMinutes,
        maxRecords: taurusApi.maxRecords,
      }),
    );
  }

  const das = config.slowSqlSource?.das;
  if (
    das?.enabled &&
    das.endpoint &&
    das.projectId &&
    das.instanceId &&
    das.authToken
  ) {
    sources.push(
      new DasSlowSqlSource({
        endpoint: das.endpoint,
        projectId: das.projectId,
        instanceId: das.instanceId,
        authToken: das.authToken,
        datastoreType: das.datastoreType,
        requestTimeoutMs: das.requestTimeoutMs,
        defaultLookbackMinutes: das.defaultLookbackMinutes,
        maxRecords: das.maxRecords,
        maxPages: das.maxPages,
      }),
    );
  }

  if (sources.length === 0) {
    return undefined;
  }
  return sources.length === 1 ? sources[0] : new CompositeSlowSqlSource(sources);
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
