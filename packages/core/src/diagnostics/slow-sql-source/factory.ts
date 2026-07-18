import type { Config } from "../../config/index.js";
import { getHuaweiCloudAuthFromConfig } from "../../cloud/auth.js";
import type { DiagnoseSlowQueryInput, FindTopSlowSqlInput } from "../types.js";
import type { SessionContext } from "../../context/session-context.js";
import { DasSlowSqlSource } from "./das-source.js";
import { TaurusApiSlowSqlSource } from "./taurus-api-source.js";
import { sortExternalSamples } from "./utils.js";
import type { ExternalSlowSqlSample, ResolveSlowSqlInput, SlowSqlSource } from "./types.js";

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
  const credentialProvider = getHuaweiCloudAuthFromConfig(config).credentialProvider;
  const sources: SlowSqlSource[] = [];
  const taurusApi = config.slowSqlSource?.taurusApi;
  if (
    taurusApi?.enabled &&
    taurusApi.endpoint &&
    taurusApi.projectId &&
    taurusApi.instanceId &&
    taurusApi.nodeId &&
    (taurusApi.authToken ||
      (config.cloud?.accessKeyId && config.cloud?.secretAccessKey) ||
      config.cloud?.keychainService)
  ) {
    sources.push(
      new TaurusApiSlowSqlSource({
        endpoint: taurusApi.endpoint,
        projectId: taurusApi.projectId,
        instanceId: taurusApi.instanceId,
        nodeId: taurusApi.nodeId,
        authToken: taurusApi.authToken,
        accessKeyId: config.cloud?.accessKeyId,
        secretAccessKey: config.cloud?.secretAccessKey,
        securityToken: config.cloud?.securityToken,
        credentialProvider,
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
    (das.authToken ||
      (config.cloud?.accessKeyId && config.cloud?.secretAccessKey) ||
      config.cloud?.keychainService)
  ) {
    sources.push(
      new DasSlowSqlSource({
        endpoint: das.endpoint,
        projectId: das.projectId,
        instanceId: das.instanceId,
        authToken: das.authToken,
        accessKeyId: config.cloud?.accessKeyId,
        secretAccessKey: config.cloud?.secretAccessKey,
        securityToken: config.cloud?.securityToken,
        credentialProvider,
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
