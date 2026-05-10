import type { DiagnosisWindow, FindTopSlowSqlInput } from "../types.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import type { ExternalSlowSqlSample, ResolveSlowSqlInput, TaurusApiCandidate } from "./types.js";

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number.parseFloat(value)
      : undefined;
}

export function normalizeTimeRange(
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

export function parseRelativeLookback(value: string | undefined): number | undefined {
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

export function formatTaurusApiTime(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

export function formatUnixSeconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000));
}

export function formatDigestTemplate(sql: string): string {
  const withoutStrings = sql.replace(/'(?:''|[^'])*'|"(?:[""]|[^"])*"/g, "?");
  const withoutNumbers = withoutStrings.replace(/\b\d+(?:\.\d+)?\b/g, "?");
  return normalizeSql(withoutNumbers);
}

export function parseDurationMs(value: unknown): number | undefined {
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

export function secondsToMs(value: unknown): number | undefined {
  const parsed = readNumber(value);
  return parsed === undefined ? undefined : parsed * 1000;
}

export function scoreCandidate(
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

export function candidateToExternalSample(
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

export function sortExternalSamples(
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

export async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = (await response.json()) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  return new URLSearchParams(
    entries.map(([key, value]) => [key, String(value)]),
  ).toString();
}

export function pickNextMarker(payload: Record<string, unknown>): string | undefined {
  return readString(
    payload.next_marker ??
      payload.nextMarker ??
      payload.marker ??
      payload.offset,
  );
}
