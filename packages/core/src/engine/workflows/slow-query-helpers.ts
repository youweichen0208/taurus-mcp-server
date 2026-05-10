import type { SessionContext } from "../../context/session-context.js";
import type { DiagnosticResult, DiagnosticRootCauseCandidate } from "../../diagnostics/types.js";
import type { ExternalSlowSqlSample } from "../../diagnostics/slow-sql-source.js";
import type { TaurusDBEngine } from "../../engine.js";
import type { EnhancedExplainResult } from "../types.js";
import type { ExplainResult } from "../../executor/sql-executor.js";
import {
  extractPlanTableNames,
  type PlanTableStats,
  type StatementDigestRow,
  type StatementWaitEventRow,
} from "../helpers.js";

export async function collectPlanTableStats(
  engine: TaurusDBEngine,
  ctx: SessionContext,
  plan: ExplainResult["plan"],
): Promise<PlanTableStats[]> {
  if (!ctx.database) {
    return [];
  }

  const planTables: Array<PlanTableStats | undefined> = await Promise.all(
    extractPlanTableNames(plan)
      .slice(0, 3)
      .map(async (table) => {
        try {
          const schema = await engine.describeTable(ctx, ctx.database!, table);
          return {
            table: `${ctx.database}.${table}`,
            rowCountEstimate: schema.rowCountEstimate,
            indexCount: schema.indexes.length,
            primaryKey: schema.primaryKey,
          } as PlanTableStats;
        } catch {
          return undefined;
        }
      }),
  );

  return planTables.filter(
    (value): value is PlanTableStats => value !== undefined,
  );
}

export function buildSlowQueryRootCauseCandidates(input: {
  riskSummary: ExplainResult["riskSummary"];
  explain: EnhancedExplainResult;
  digestSample?: StatementDigestRow;
  runtimeLockTimeMs?: number;
  waitEventRows: StatementWaitEventRow[];
}): DiagnosticRootCauseCandidate[] {
  const { riskSummary, explain, digestSample, runtimeLockTimeMs, waitEventRows } =
    input;
  const candidates: DiagnosticRootCauseCandidate[] = [];

  if (riskSummary.fullTableScanLikely) {
    candidates.push({
      code: "slow_query_full_table_scan",
      title: "Full table scan is the dominant slowdown signal",
      confidence:
        (riskSummary.estimatedRows ?? 0) >= 100_000 ? "high" : "medium",
      rationale: `EXPLAIN indicates a likely full table scan${riskSummary.estimatedRows !== undefined ? ` across about ${riskSummary.estimatedRows} rows` : ""}.`,
    });
  }
  if (riskSummary.usesFilesort) {
    candidates.push({
      code: "slow_query_filesort",
      title: "Filesort overhead is contributing to latency",
      confidence: "medium",
      rationale:
        "EXPLAIN shows filesort usage, which usually means extra sort work and potential disk spill under pressure.",
    });
  }
  if (riskSummary.usesTempStructure) {
    candidates.push({
      code: "slow_query_temp_structure",
      title: "Temporary structures are increasing execution cost",
      confidence: "medium",
      rationale:
        "EXPLAIN shows temporary structures, which often indicates expensive grouping, sorting, or join reshaping.",
    });
  }
  if (!riskSummary.indexHitLikely) {
    candidates.push({
      code: "slow_query_poor_index_usage",
      title: "Index usage looks weak or absent",
      confidence: riskSummary.fullTableScanLikely ? "high" : "medium",
      rationale:
        "The plan does not look index-friendly, which increases scanned rows and slows execution.",
    });
  }
  if (
    explain.taurusHints.parallelQuery.blockedReason ||
    explain.taurusHints.ndpPushdown.blockedReason
  ) {
    candidates.push({
      code: "slow_query_taurus_feature_gap",
      title: "TaurusDB acceleration features may not be fully available",
      confidence: "low",
      rationale: [
        explain.taurusHints.parallelQuery.blockedReason,
        explain.taurusHints.ndpPushdown.blockedReason,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" "),
    });
  }
  if ((digestSample?.avgTmpDiskTables ?? 0) > 0) {
    candidates.push({
      code: "slow_query_tmp_disk_spill",
      title: "Temporary tables are spilling to disk",
      confidence: (digestSample?.avgTmpDiskTables ?? 0) >= 1 ? "medium" : "low",
      rationale: `Digest summaries show about ${digestSample?.avgTmpDiskTables} temporary disk tables per execution, which suggests spill-heavy grouping or sorting.`,
    });
  }
  if ((runtimeLockTimeMs ?? 0) >= 10) {
    candidates.push({
      code: "slow_query_lock_wait_pressure",
      title: "Lock wait time is a material part of the statement latency",
      confidence: (runtimeLockTimeMs ?? 0) >= 100 ? "high" : "medium",
      rationale: `${digestSample?.avgLockTimeMs !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeLockTimeMs} ms of lock time per execution, which suggests blocking or lock-wait pressure on the statement path.`,
    });
  }

  const topWaitEvent = waitEventRows[0];
  if (topWaitEvent?.eventName?.startsWith("wait/lock/")) {
    candidates.push({
      code: "slow_query_wait_event_lock_contention",
      title: "Runtime wait events point to lock contention",
      confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "high" : "medium",
      rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event${topWaitEvent.totalWaitMs !== undefined ? ` with about ${topWaitEvent.totalWaitMs} ms total wait time` : ""}.`,
    });
  } else if (topWaitEvent?.eventName?.startsWith("wait/io/")) {
    candidates.push({
      code: "slow_query_wait_event_io_pressure",
      title: "Runtime wait events point to I/O-bound execution",
      confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
      rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which usually indicates file or handler I/O pressure.`,
    });
  } else if (topWaitEvent?.eventName?.startsWith("wait/synch/")) {
    candidates.push({
      code: "slow_query_wait_event_sync_contention",
      title: "Runtime wait events point to synchronization contention",
      confidence: (topWaitEvent.totalWaitMs ?? 0) >= 100 ? "medium" : "low",
      rationale: `Statement history shows ${topWaitEvent.eventName} as the dominant nested wait event, which suggests mutex or rwlock contention in the execution path.`,
    });
  }
  if (
    (digestSample?.noIndexUsedCount ?? 0) > 0 ||
    (digestSample?.selectScanCount ?? 0) > 0
  ) {
    candidates.push({
      code: "slow_query_runtime_scan_pressure",
      title: "Runtime summaries show scan-heavy executions",
      confidence: (digestSample?.noIndexUsedCount ?? 0) > 0 ? "medium" : "low",
      rationale: `Digest summaries recorded${(digestSample?.selectScanCount ?? 0) > 0 ? ` ${digestSample?.selectScanCount} scan-driven executions` : ""}${(digestSample?.selectScanCount ?? 0) > 0 && (digestSample?.noIndexUsedCount ?? 0) > 0 ? " and" : ""}${(digestSample?.noIndexUsedCount ?? 0) > 0 ? ` ${digestSample?.noIndexUsedCount} executions without index usage` : ""}.`,
    });
  }
  if (candidates.length === 0) {
    candidates.push({
      code: "slow_query_plan_collected",
      title: "Plan evidence was collected but no single dominant cause stood out",
      confidence: "low",
      rationale:
        "Live EXPLAIN evidence was collected, but the current heuristics did not isolate a single dominant full-scan, sort, or temporary-structure bottleneck.",
    });
  }

  return candidates;
}

export function buildSlowQueryKeyFindings(input: {
  riskSummary: ExplainResult["riskSummary"];
  resolvedPlanTables: PlanTableStats[];
  digestSample?: StatementDigestRow;
  externalSlowSqlSample?: ExternalSlowSqlSample;
  runtimeRowsExamined?: number;
  runtimeLockTimeMs?: number;
  waitEventRows: StatementWaitEventRow[];
}): string[] {
  const {
    riskSummary,
    resolvedPlanTables,
    digestSample,
    externalSlowSqlSample,
    runtimeRowsExamined,
    runtimeLockTimeMs,
    waitEventRows,
  } = input;
  const keyFindings = [
    riskSummary.estimatedRows !== undefined
      ? `EXPLAIN estimated about ${riskSummary.estimatedRows} rows for the analyzed statement.`
      : "EXPLAIN row estimate was not available.",
    riskSummary.fullTableScanLikely
      ? "The current plan is likely scanning the full table."
      : "The current plan does not strongly indicate a full table scan.",
    riskSummary.usesFilesort || riskSummary.usesTempStructure
      ? `The plan uses${riskSummary.usesFilesort ? " filesort" : ""}${riskSummary.usesFilesort && riskSummary.usesTempStructure ? " and" : ""}${riskSummary.usesTempStructure ? " temporary structures" : ""}.`
      : "The plan does not show filesort or temporary-structure overhead.",
  ];

  if (resolvedPlanTables.length > 0) {
    keyFindings.push(
      ...resolvedPlanTables.map(
        (tableStats) =>
          `${tableStats.table} has${tableStats.rowCountEstimate !== undefined ? ` row estimate ${tableStats.rowCountEstimate}` : " unknown row estimate"} and ${tableStats.indexCount} indexes.`,
      ),
    );
  }
  if (runtimeRowsExamined !== undefined) {
    keyFindings.push(
      `${digestSample?.avgRowsExamined !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeRowsExamined} rows examined per execution.`,
    );
  }
  if (runtimeLockTimeMs !== undefined) {
    keyFindings.push(
      `${digestSample?.avgLockTimeMs !== undefined ? "Digest summaries" : "External slow-log samples"} show about ${runtimeLockTimeMs} ms of lock time per execution.`,
    );
  }
  if (
    digestSample &&
    ((digestSample.avgTmpTables ?? 0) > 0 ||
      (digestSample.avgTmpDiskTables ?? 0) > 0)
  ) {
    keyFindings.push(
      `Digest summaries show temporary table usage${digestSample.avgTmpTables !== undefined ? ` (avg_tmp_tables=${digestSample.avgTmpTables}` : ""}${digestSample.avgTmpDiskTables !== undefined ? `${digestSample.avgTmpTables !== undefined ? ", " : " ("}avg_tmp_disk_tables=${digestSample.avgTmpDiskTables}` : ""}${digestSample.avgTmpTables !== undefined || digestSample.avgTmpDiskTables !== undefined ? ")" : ""}.`,
    );
  }
  if (externalSlowSqlSample && !digestSample) {
    keyFindings.push(
      `External TaurusDB slow-log samples resolved SQL text${externalSlowSqlSample.startTime ? ` from ${externalSlowSqlSample.startTime}` : ""}${externalSlowSqlSample.database ? ` for database ${externalSlowSqlSample.database}` : ""}.`,
    );
  }
  if (waitEventRows.length > 0) {
    keyFindings.push(
      `Statement history shows ${waitEventRows[0].eventName}${waitEventRows[0].totalWaitMs !== undefined ? ` as the top nested wait event (${waitEventRows[0].totalWaitMs} ms total)` : " as the top nested wait event"}.`,
    );
  }

  return keyFindings;
}

export function buildSlowQueryRecommendedActions(input: {
  standardPlan: ExplainResult;
  explain: EnhancedExplainResult;
  riskSummary: ExplainResult["riskSummary"];
  resolvedPlanTables: PlanTableStats[];
  digestSample?: StatementDigestRow;
  runtimeLockTimeMs?: number;
  topWaitEvent?: StatementWaitEventRow;
}): string[] {
  const {
    standardPlan,
    explain,
    riskSummary,
    resolvedPlanTables,
    digestSample,
    runtimeLockTimeMs,
    topWaitEvent,
  } = input;
  const recommendedActions = [
    ...standardPlan.recommendations,
    ...explain.optimizationSuggestions,
  ];

  if (riskSummary.fullTableScanLikely) {
    recommendedActions.push(
      "Review predicates and indexes so the query can avoid scanning the full table.",
    );
  }
  if (riskSummary.usesFilesort || riskSummary.usesTempStructure) {
    recommendedActions.push(
      "Review ORDER BY / GROUP BY / JOIN shape to reduce filesort and temporary-structure work.",
    );
  }
  if (
    explain.taurusHints.parallelQuery.blockedReason ||
    explain.taurusHints.ndpPushdown.blockedReason
  ) {
    recommendedActions.push(
      "Verify whether TaurusDB acceleration features are available and enabled for this workload.",
    );
  }
  if (
    !riskSummary.indexHitLikely &&
    resolvedPlanTables.some((tableStats) => tableStats.indexCount > 0)
  ) {
    recommendedActions.push(
      "The referenced tables already have indexes; compare the current predicates and sort columns against existing index definitions.",
    );
  }
  if ((digestSample?.avgTmpDiskTables ?? 0) > 0) {
    recommendedActions.push(
      "Check whether ORDER BY / GROUP BY can be supported by indexes to reduce temporary disk tables.",
    );
  }
  if ((digestSample?.noIndexUsedCount ?? 0) > 0) {
    recommendedActions.push(
      "Runtime digest summaries show no-index executions; compare the query shape with existing indexes and predicate selectivity.",
    );
  }
  if ((runtimeLockTimeMs ?? 0) >= 10) {
    recommendedActions.push(
      "Investigate blocker sessions or transaction scope because digest summaries show non-trivial lock time.",
    );
  }
  if (topWaitEvent?.eventName?.startsWith("wait/lock/")) {
    recommendedActions.push(
      "Correlate the dominant lock wait event with blocker sessions, transaction scope, and hot rows before changing the SQL shape.",
    );
  }
  if (topWaitEvent?.eventName?.startsWith("wait/io/")) {
    recommendedActions.push(
      "Check whether the dominant I/O wait aligns with table scans, filesort spill, or storage pressure on the accessed objects.",
    );
  }
  if (topWaitEvent?.eventName?.startsWith("wait/synch/")) {
    recommendedActions.push(
      "Inspect concurrency hotspots because synchronization waits suggest contention beyond the SQL text itself.",
    );
  }

  return [...new Set(recommendedActions)];
}

export function buildSlowQueryEvidence(input: {
  standardPlan: ExplainResult;
  riskSummary: ExplainResult["riskSummary"];
  resolvedPlanTables: PlanTableStats[];
  digestSample?: StatementDigestRow;
  externalSlowSqlSample?: ExternalSlowSqlSample;
  waitEventRows: StatementWaitEventRow[];
}): DiagnosticResult["evidence"] {
  const {
    standardPlan,
    riskSummary,
    resolvedPlanTables,
    digestSample,
    externalSlowSqlSample,
    waitEventRows,
  } = input;

  return [
    ...(externalSlowSqlSample
      ? [
          {
            source: externalSlowSqlSample.source,
            title: "External slow-log sample",
            summary: `A SQL sample was resolved from TaurusDB slow-log APIs${externalSlowSqlSample.avgLatencyMs !== undefined ? `; avg_latency_ms=${externalSlowSqlSample.avgLatencyMs}` : ""}${externalSlowSqlSample.avgLockTimeMs !== undefined ? `, avg_lock_time_ms=${externalSlowSqlSample.avgLockTimeMs}` : ""}${externalSlowSqlSample.avgRowsExamined !== undefined ? `, avg_rows_examined=${externalSlowSqlSample.avgRowsExamined}` : ""}${externalSlowSqlSample.execCount !== undefined ? `, exec_count=${externalSlowSqlSample.execCount}` : ""}${externalSlowSqlSample.database ? `, database=${externalSlowSqlSample.database}` : ""}.`,
            rawRef: externalSlowSqlSample.rawRef,
          },
        ]
      : []),
    ...(digestSample
      ? [
          {
            source: "statement_digest",
            title: "Digest summary sample",
            summary: `A query sample was resolved from performance_schema.events_statements_summary_by_digest${digestSample.execCount !== undefined ? `; exec_count=${digestSample.execCount}` : ""}${digestSample.avgLatencyMs !== undefined ? `, avg_latency_ms=${digestSample.avgLatencyMs}` : ""}${digestSample.maxLatencyMs !== undefined ? `, max_latency_ms=${digestSample.maxLatencyMs}` : ""}${digestSample.avgLockTimeMs !== undefined ? `, avg_lock_time_ms=${digestSample.avgLockTimeMs}` : ""}${digestSample.avgRowsExamined !== undefined ? `, avg_rows_examined=${digestSample.avgRowsExamined}` : ""}${digestSample.avgTmpDiskTables !== undefined ? `, avg_tmp_disk_tables=${digestSample.avgTmpDiskTables}` : ""}${digestSample.noIndexUsedCount !== undefined ? `, no_index_used_count=${digestSample.noIndexUsedCount}` : ""}.`,
          },
        ]
      : []),
    ...waitEventRows.map((row, index) => ({
      source: "statement_wait_history",
      title:
        index === 0
          ? "Dominant nested wait event"
          : `Nested wait event ${index + 1}`,
      summary: `${row.eventName ?? "unknown_event"}${row.totalWaitMs !== undefined ? ` total_wait_ms=${row.totalWaitMs}` : ""}${row.avgWaitMs !== undefined ? `, avg_wait_ms=${row.avgWaitMs}` : ""}${row.sampleCount !== undefined ? `, sample_count=${row.sampleCount}` : ""}${row.statementCount !== undefined ? `, statement_count=${row.statementCount}` : ""}.`,
    })),
    {
      source: "explain",
      title: "Live EXPLAIN plan",
      summary: `A live EXPLAIN plan was collected for the provided SQL${standardPlan.queryId ? ` (query id ${standardPlan.queryId})` : ""}.`,
    },
    {
      source: "explain",
      title: "Plan risk summary",
      summary: `full_scan=${riskSummary.fullTableScanLikely}, index_hit=${riskSummary.indexHitLikely}, filesort=${riskSummary.usesFilesort}, temp_structure=${riskSummary.usesTempStructure}${riskSummary.estimatedRows !== undefined ? `, estimated_rows=${riskSummary.estimatedRows}` : ""}.`,
    },
    ...resolvedPlanTables.map((tableStats) => ({
      source: "table_schema",
      title: `Referenced table ${tableStats.table}`,
      summary: `${tableStats.table} has${tableStats.rowCountEstimate !== undefined ? ` row_count_estimate=${tableStats.rowCountEstimate}` : " unknown row count"}${tableStats.primaryKey && tableStats.primaryKey.length > 0 ? `, primary_key=${tableStats.primaryKey.join(",")}` : ""}, index_count=${tableStats.indexCount}.`,
    })),
  ];
}
