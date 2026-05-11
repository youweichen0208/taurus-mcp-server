import type { SessionContext } from "../../context/session-context.js";
import type { MetricAlias, MetricSummary, MetricsSource } from "../../diagnostics/metrics-source.js";
import type {
  DbHotspotItem,
  DiagnosticBaseInput,
  DiagnosticNextToolInput,
  DiagnosticRootCauseCandidate,
  DiagnosticSeverity,
  DiagnoseConnectionSpikeInput,
  DiagnoseLockContentionInput,
  ServiceLatencyCandidate,
  ServiceLatencySuspectedCategory,
} from "../../diagnostics/types.js";
import type { ExplainResult } from "../../executor/sql-executor.js";

export function countBy<T>(
  rows: T[],
  pick: (row: T) => string | undefined,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    );
}

export function pickMetric(
  metrics: MetricSummary[],
  alias: MetricAlias,
): MetricSummary | undefined {
  return metrics.find((metric) => metric.alias === alias);
}

export function metricSummaryText(metric: MetricSummary): string {
  const parts = [
    `metric=${metric.metricName}`,
    `points=${metric.points.length}`,
    metric.latest !== undefined
      ? `latest=${roundMetric(metric.latest)}`
      : undefined,
    metric.max !== undefined ? `max=${roundMetric(metric.max)}` : undefined,
    metric.avg !== undefined ? `avg=${roundMetric(metric.avg)}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(", ");
}

export function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface SafeMetricsQueryResult {
  metrics: MetricSummary[];
  error?: string;
}

export async function queryMetricsSafely(
  source: MetricsSource | undefined,
  aliases: MetricAlias[],
  input: DiagnosticBaseInput,
  ctx: SessionContext,
): Promise<MetricSummary[]> {
  const result = await queryMetricsWithStatus(source, aliases, input, ctx);
  return result.metrics;
}

export async function queryMetricsWithStatus(
  source: MetricsSource | undefined,
  aliases: MetricAlias[],
  input: DiagnosticBaseInput,
  ctx: SessionContext,
): Promise<SafeMetricsQueryResult> {
  if (!source) {
    return { metrics: [] };
  }
  try {
    return {
      metrics: await source.query({ aliases, timeRange: input.timeRange }, ctx),
    };
  } catch (error) {
    return {
      metrics: [],
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Metrics query failed.",
    };
  }
}

export function metricsSourceLimitation(source: MetricsSource | undefined): string[] {
  return source
    ? []
    : ["No CES or control-plane metrics source is configured yet."];
}

export function confidenceWeight(
  value: ServiceLatencyCandidate["confidence"],
): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

export function rootCauseBasePriority(code: string): number {
  switch (code) {
    case "slow_query_full_table_scan":
      return 90;
    case "slow_query_poor_index_usage":
      return 60;
    case "slow_query_runtime_scan_pressure":
      return 70;
    case "slow_query_tmp_disk_spill":
      return 65;
    case "slow_query_wait_event_lock_contention":
      return 60;
    case "slow_query_lock_wait_pressure":
      return 55;
    case "slow_query_filesort":
      return 50;
    case "slow_query_temp_structure":
      return 45;
    case "slow_query_wait_event_io_pressure":
      return 40;
    case "slow_query_wait_event_sync_contention":
      return 35;
    case "slow_query_taurus_feature_gap":
      return 20;
    case "slow_query_plan_collected":
      return 10;
    default:
      return 0;
  }
}

export function rootCauseConfidenceWeight(
  value: DiagnosticRootCauseCandidate["confidence"],
): number {
  switch (value) {
    case "high":
      return 30;
    case "medium":
      return 15;
    default:
      return 0;
  }
}

export function rootCauseRankScore(candidate: DiagnosticRootCauseCandidate): number {
  return (
    rootCauseBasePriority(candidate.code) +
    rootCauseConfidenceWeight(candidate.confidence)
  );
}

export function sortRootCauseCandidates(
  candidates: DiagnosticRootCauseCandidate[],
): DiagnosticRootCauseCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      rootCauseRankScore(right) - rootCauseRankScore(left) ||
      rootCauseBasePriority(right.code) - rootCauseBasePriority(left.code) ||
      rootCauseConfidenceWeight(right.confidence) -
        rootCauseConfidenceWeight(left.confidence) ||
      left.code.localeCompare(right.code),
  );
}

export function severityFromSlowQueryEvidence(
  riskSummary: ExplainResult["riskSummary"],
  candidates: DiagnosticRootCauseCandidate[],
): DiagnosticSeverity {
  if (
    riskSummary.fullTableScanLikely ||
    riskSummary.usesFilesort ||
    riskSummary.usesTempStructure
  ) {
    return (riskSummary.estimatedRows ?? 0) >= 100_000 ? "high" : "warning";
  }
  if (candidates.some((candidate) => candidate.confidence === "high")) {
    return "warning";
  }
  if (candidates.some((candidate) => candidate.confidence === "medium")) {
    return "warning";
  }
  return "info";
}

export function serviceCategoryPriority(
  value: ServiceLatencySuspectedCategory,
): number {
  switch (value) {
    case "lock_contention":
      return 5;
    case "connection_spike":
      return 4;
    case "slow_sql":
      return 3;
    case "resource_pressure":
      return 2;
    case "mixed":
    default:
      return 1;
  }
}

export function hotspotTypePriority(value: DbHotspotItem["type"]): number {
  switch (value) {
    case "session":
      return 3;
    case "table":
      return 2;
    case "sql":
    default:
      return 1;
  }
}

export function buildSlowQueryNextToolInput(
  source: {
    sqlHash?: string;
    digestText?: string;
    sampleSql?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput | undefined {
  const slowQueryInput: Record<string, unknown> = {};
  if (input.datasource) {
    slowQueryInput.datasource = input.datasource;
  }
  if (input.database) {
    slowQueryInput.database = input.database;
  }
  if (input.timeRange) {
    slowQueryInput.time_range = input.timeRange;
  }
  if (input.evidenceLevel) {
    slowQueryInput.evidence_level = input.evidenceLevel;
  }
  if (input.includeRawEvidence !== undefined) {
    slowQueryInput.include_raw_evidence = input.includeRawEvidence;
  }
  if (input.maxCandidates !== undefined) {
    slowQueryInput.max_candidates = input.maxCandidates;
  }
  if (source.sampleSql) {
    slowQueryInput.sql = source.sampleSql;
  } else if (source.digestText) {
    slowQueryInput.digest_text = source.digestText;
  } else if (source.sqlHash) {
    slowQueryInput.sql_hash = source.sqlHash;
  } else {
    return undefined;
  }

  return {
    tool: "diagnose_slow_query",
    input: slowQueryInput,
    rationale,
  };
}

export function buildBaseNextToolInput(
  input: DiagnosticBaseInput,
): Record<string, unknown> {
  const nextInput: Record<string, unknown> = {};
  if (input.datasource) {
    nextInput.datasource = input.datasource;
  }
  if (input.database) {
    nextInput.database = input.database;
  }
  if (input.timeRange) {
    nextInput.time_range = input.timeRange;
  }
  if (input.evidenceLevel) {
    nextInput.evidence_level = input.evidenceLevel;
  }
  if (input.includeRawEvidence !== undefined) {
    nextInput.include_raw_evidence = input.includeRawEvidence;
  }
  if (input.maxCandidates !== undefined) {
    nextInput.max_candidates = input.maxCandidates;
  }
  return nextInput;
}

export function buildDbHotspotNextToolInput(
  source: {
    scope?: "sql" | "table" | "session";
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.scope) {
    nextInput.scope = source.scope;
  }
  return {
    tool: "diagnose_db_hotspot",
    input: nextInput,
    rationale,
  };
}

export function buildFindTopSlowSqlNextToolInput(
  source: {
    sortBy?: "avg_latency" | "total_latency" | "exec_count" | "lock_time";
    topN?: number;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.sortBy) {
    nextInput.sort_by = source.sortBy;
  }
  if (source.topN !== undefined) {
    nextInput.top_n = source.topN;
  }
  return {
    tool: "find_top_slow_sql",
    input: nextInput,
    rationale,
  };
}

export function buildLockContentionNextToolInput(
  source: {
    table?: string;
    blockerSessionId?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.table) {
    nextInput.table = source.table;
  }
  if (source.blockerSessionId) {
    nextInput.blocker_session_id = source.blockerSessionId;
  }
  return {
    tool: "diagnose_lock_contention",
    input: nextInput,
    rationale,
  };
}

export function buildConnectionSpikeNextToolInput(
  source: {
    user?: string;
    clientHost?: string;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.user) {
    nextInput.user = source.user;
  }
  if (source.clientHost) {
    nextInput.client_host = source.clientHost;
  }
  nextInput.compare_baseline = false;
  return {
    tool: "diagnose_connection_spike",
    input: nextInput,
    rationale,
  };
}

export function buildShowProcesslistNextToolInput(
  source: {
    user?: string;
    host?: string;
    command?: string;
    includeIdle?: boolean;
    includeInfo?: boolean;
  },
  input: DiagnosticBaseInput,
  rationale: string,
): DiagnosticNextToolInput {
  const nextInput = buildBaseNextToolInput(input);
  if (source.user) {
    nextInput.user = source.user;
  }
  if (source.host) {
    nextInput.host = source.host;
  }
  if (source.command) {
    nextInput.command = source.command;
  }
  nextInput.include_idle = source.includeIdle ?? true;
  nextInput.include_info = source.includeInfo ?? true;
  nextInput.max_rows = 20;
  return {
    tool: "show_processlist",
    input: nextInput,
    rationale,
  };
}

export function dedupeNextToolInputs(
  inputs: DiagnosticNextToolInput[],
): DiagnosticNextToolInput[] {
  return inputs.filter((item, index, allItems) => {
    const key = `${item.tool}:${JSON.stringify(item.input)}`;
    return (
      allItems.findIndex((candidate) => {
        const candidateKey = `${candidate.tool}:${JSON.stringify(candidate.input)}`;
        return candidateKey === key;
      }) === index
    );
  });
}

export function evidenceRowLimit(
  level: DiagnoseConnectionSpikeInput["evidenceLevel"],
): number {
  switch (level) {
    case "full":
      return 100;
    case "standard":
      return 50;
    default:
      return 20;
  }
}

export function lockEvidenceRowLimit(
  level: DiagnoseLockContentionInput["evidenceLevel"],
): number {
  switch (level) {
    case "full":
      return 100;
    case "standard":
      return 50;
    default:
      return 20;
  }
}
