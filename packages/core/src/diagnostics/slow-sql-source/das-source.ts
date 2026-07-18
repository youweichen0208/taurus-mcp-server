import { fetchHuaweiCloud, type HuaweiCloudCredentialProvider } from "../../cloud/auth.js";
import type { SessionContext } from "../../context/session-context.js";
import type { FindTopSlowSqlInput } from "../types.js";
import { buildQueryString, candidateToExternalSample, formatUnixSeconds, normalizeTimeRange, parseResponse, pickNextMarker, readNumber, readString, scoreCandidate, secondsToMs, sortExternalSamples } from "./utils.js";
import { parseDasSlowLogCandidate, parseDasSqlStatementCandidate, pickDasTopSlowArrays } from "./parsers.js";
import type { ExternalSlowSqlSample, ResolveSlowSqlInput, SlowSqlSource, TaurusApiCandidate } from "./types.js";

type DasSlowSqlSourceOptions = {
  endpoint: string;
  projectId: string;
  instanceId: string;
  authToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  securityToken?: string;
  credentialProvider?: HuaweiCloudCredentialProvider;
  datastoreType: "MySQL" | "TaurusDB";
  requestTimeoutMs: number;
  defaultLookbackMinutes: number;
  maxRecords: number;
  maxPages: number;
  fetchImpl?: typeof fetch;
};

export class DasSlowSqlSource implements SlowSqlSource {
  private readonly endpoint: string;
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly authToken?: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly securityToken?: string;
  private readonly credentialProvider?: HuaweiCloudCredentialProvider;
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
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.securityToken = options.securityToken;
    this.credentialProvider = options.credentialProvider;
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
    const timeWindow = normalizeTimeRange(
      input.timeRange,
      this.defaultLookbackMinutes,
    );
    const payload = await this.getJson(
      `/v3/${this.projectId}/instances/${this.instanceId}/top-slow-log`,
      {
        datastore_type: this.datastoreType,
        start_at: formatUnixSeconds(new Date(timeWindow.startTime)),
        end_at: formatUnixSeconds(new Date(timeWindow.endTime)),
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
      const response = await fetchHuaweiCloud({
        url: `${this.endpoint}${path}${queryString ? `?${queryString}` : ""}`,
        method: "GET",
        headers: {
          "content-type": "application/json",
        },
        auth: {
          authToken: this.authToken,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          securityToken: this.securityToken,
          credentialProvider: this.credentialProvider,
        },
        fetchImpl: (input, init) =>
          this.fetchImpl(input, {
            ...init,
            signal: controller.signal,
          }),
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
