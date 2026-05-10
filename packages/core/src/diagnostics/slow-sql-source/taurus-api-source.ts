import { fetchHuaweiCloud } from "../../cloud/auth.js";
import type { SessionContext } from "../../context/session-context.js";
import type { FindTopSlowSqlInput } from "../types.js";
import { candidateToExternalSample, normalizeTimeRange, parseResponse, scoreCandidate, sortExternalSamples } from "./utils.js";
import { parseDetailCandidate, parseStatisticsCandidate, pickArrayCandidate } from "./parsers.js";
import type { ExternalSlowSqlSample, ResolveSlowSqlInput, SlowSqlSource, TaurusApiCandidate } from "./types.js";

type TaurusApiSlowSqlSourceOptions = {
  endpoint: string;
  projectId: string;
  instanceId: string;
  nodeId: string;
  authToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  securityToken?: string;
  language: "en-us" | "zh-cn";
  requestTimeoutMs: number;
  defaultLookbackMinutes: number;
  maxRecords: number;
  fetchImpl?: typeof fetch;
};

export class TaurusApiSlowSqlSource implements SlowSqlSource {
  private readonly endpoint: string;
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly nodeId: string;
  private readonly authToken?: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly securityToken?: string;
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
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.securityToken = options.securityToken;
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
      const body = JSON.stringify(payload);
      const response = await fetchHuaweiCloud({
        url: `${this.endpoint}${path}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-language": this.language,
        },
        body,
        auth: {
          authToken: this.authToken,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          securityToken: this.securityToken,
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
