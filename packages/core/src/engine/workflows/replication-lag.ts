import { UnsupportedFeatureError } from "../../capability/types.js";
import type { SessionContext } from "../../context/session-context.js";
import {
  createPlaceholderDiagnosticResult,
  type DbHotspotResult,
  type DiagnoseConnectionSpikeInput,
  type DiagnoseDbHotspotInput,
  type DiagnoseLockContentionInput,
  type DiagnoseReplicationLagInput,
  type DiagnoseServiceLatencyInput,
  type DiagnoseSlowQueryInput,
  type DiagnoseStoragePressureInput,
  type DiagnosticBaseInput,
  type DiagnosticNextToolInput,
  type DiagnosticResult,
  type DiagnosticRootCauseCandidate,
  type DiagnosticSeverity,
  type FindTopSlowSqlInput,
  type FindTopSlowSqlResult,
  type ServiceLatencyCandidate,
  type ServiceLatencyResult,
  type ServiceLatencySuspectedCategory,
} from "../../diagnostics/types.js";
import {
  buildResolveSlowSqlInput,
  type ExternalSlowSqlSample,
} from "../../diagnostics/slow-sql-source.js";
import type { TaurusDBEngine } from "../../engine.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import {
  buildConnectionSpikeNextToolInput,
  buildDbHotspotNextToolInput,
  buildFindTopSlowSqlNextToolInput,
  buildLockContentionNextToolInput,
  buildShowProcesslistNextToolInput,
  buildSlowQueryNextToolInput,
  clampInteger,
  confidenceWeight,
  countBy,
  dedupeNextToolInputs,
  evidenceRowLimit,
  extractPlanTableNames,
  hotspotTypePriority,
  isIdleTransactionBlocker,
  lockEvidenceRowLimit,
  metricSummaryText,
  metricsSourceLimitation,
  parseLockWaitRows,
  parseProcesslistRows,
  parseReplicationStatusRows,
  pickMetric,
  queryMetricsSafely,
  roundMetric,
  serviceCategoryPriority,
  severityFromSlowQueryEvidence,
  sortRootCauseCandidates,
  withDatasourceSummary,
  type PlanTableStats,
  type StatementDigestRow,
  type TableStorageRow,
} from "../helpers.js";

export async function diagnoseReplicationLag(
  engine: TaurusDBEngine,
  input: DiagnoseReplicationLagInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
    const [metrics, replicationStatus] = await Promise.all([
      queryMetricsSafely(
        engine.metricsSource,
        [
          "replication_delay",
          "long_trx_count",
          "write_iops",
          "write_throughput",
        ],
        input,
        ctx,
      ),
      engine.executor
        .executeReadonly("SHOW REPLICA STATUS", ctx, { maxRows: 10 })
        .catch(async () =>
          engine.executor
            .executeReadonly("SHOW SLAVE STATUS", ctx, { maxRows: 10 })
            .catch(() => undefined),
        ),
    ]);
    const rows = replicationStatus
      ? parseReplicationStatusRows(replicationStatus)
      : [];
    const focusedRows = input.channel
      ? rows.filter((row) => row.channelName === input.channel)
      : rows;
    const replicationDelayMetric = pickMetric(metrics, "replication_delay");
    const longTrxMetric = pickMetric(metrics, "long_trx_count");
    const writeIopsMetric = pickMetric(metrics, "write_iops");
    const writeThroughputMetric = pickMetric(metrics, "write_throughput");
    const metricEvidence = metrics.map((metric) => ({
      source: "ces_metrics",
      title: `CES ${metric.alias}`,
      summary: metricSummaryText(metric),
    }));
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];

    if (focusedRows.length === 0 && metrics.length === 0) {
      return {
        tool: "diagnose_replication_lag",
        status: "not_applicable",
        severity: "info",
        summary: withDatasourceSummary(
          "Replication-lag diagnosis did not find replica status or CES lag metrics",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "replication_lag_no_evidence",
            title: "Replication evidence unavailable",
            confidence: "low",
            rationale:
              "No replica status rows or Cloud Eye replication metrics were available for the selected datasource.",
          },
        ],
        keyFindings: [
          input.replicaId
            ? `Replica focus provided: ${input.replicaId}.`
            : "No replica identifier was provided.",
          input.channel
            ? `Replication channel provided: ${input.channel}.`
            : "No replication channel was provided.",
          "SHOW REPLICA STATUS / SHOW SLAVE STATUS did not return usable rows.",
        ],
        evidence: [
          {
            source: "replication_status",
            title: "Replica status",
            summary:
              "No rows were returned from SHOW REPLICA STATUS or SHOW SLAVE STATUS.",
          },
        ],
        recommendedActions: [
          "Run this diagnostic on a replica or read-only node with replication status access.",
          "Enable the CES metrics source to correlate replica lag with Cloud Eye lag, write IOPS, and long transaction metrics.",
        ],
        recommendedNextTools: ["show_processlist"],
        nextToolInputs: [
          buildShowProcesslistNextToolInput(
            {
              includeIdle: false,
              includeInfo: true,
            },
            input,
            "Inspect live sessions on the replica or selected datasource to confirm whether replay is blocked by long-running or idle-in-transaction work.",
          ),
        ],
        limitations: [
          ...metricsSourceLimitation(engine.metricsSource),
          "The selected account may not have access to replication status commands.",
        ],
      };
    }

    const lagSecondsFromStatus = focusedRows
      .map((row) => row.secondsBehindSource)
      .filter((value): value is number => value !== undefined);
    const maxStatusLag =
      lagSecondsFromStatus.length > 0
        ? Math.max(...lagSecondsFromStatus)
        : undefined;
    const maxCesLag = replicationDelayMetric?.max;
    const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
    const stoppedRows = focusedRows.filter(
      (row) =>
        row.replicaIoRunning?.toLowerCase() === "no" ||
        row.replicaSqlRunning?.toLowerCase() === "no" ||
        row.lastIoError ||
        row.lastSqlError,
    );
    if (stoppedRows.length > 0) {
      rootCauseCandidates.push({
        code: "replication_lag_applier_or_io_thread_stopped",
        title: "Replica IO or SQL applier is stopped or reporting errors",
        confidence: "high",
        rationale: `Replica status returned ${stoppedRows.length} rows with stopped threads or IO/SQL errors.`,
      });
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildShowProcesslistNextToolInput(
          {
            includeIdle: false,
            includeInfo: true,
          },
          input,
          "Inspect live sessions and statement text before restarting replica IO/SQL components.",
        ),
      );
    }
    if ((maxCesLag ?? 0) >= 60 || (maxStatusLag ?? 0) >= 60) {
      rootCauseCandidates.push({
        code: "replication_lag_delay_confirmed",
        title: "Replication delay is elevated",
        confidence: (maxCesLag ?? maxStatusLag ?? 0) >= 300 ? "high" : "medium",
        rationale: `Replication lag exceeded the current threshold${maxCesLag !== undefined ? `; max_ces_lag=${roundMetric(maxCesLag)}` : ""}${maxStatusLag !== undefined ? `, max_status_lag=${roundMetric(maxStatusLag)}` : ""}.`,
      });
      recommendedNextTools.add("diagnose_db_hotspot");
      nextToolInputs.push(
        buildDbHotspotNextToolInput(
          { scope: "session" },
          input,
          "Correlate elevated replication delay with the hottest sessions on the datasource during the same window.",
        ),
      );
    }
    if (longTrxMetric && (longTrxMetric.max ?? 0) > 0) {
      rootCauseCandidates.push({
        code: "replication_lag_long_transaction_pressure",
        title: "Long transactions may delay replica replay",
        confidence: (longTrxMetric?.max ?? 0) >= 3 ? "medium" : "low",
        rationale: `CES long transaction count was non-zero; ${metricSummaryText(longTrxMetric)}.`,
      });
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildShowProcesslistNextToolInput(
          {
            includeIdle: false,
            includeInfo: true,
          },
          input,
          "Inspect long-running sessions because open transactions can delay replica replay.",
        ),
      );
    }
    if (
      (writeIopsMetric?.max ?? 0) >= 1000 ||
      (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024
    ) {
      rootCauseCandidates.push({
        code: "replication_lag_write_pressure",
        title: "Primary-side write pressure may be outpacing replay",
        confidence: "medium",
        rationale: `CES write workload metrics are elevated${writeIopsMetric?.max !== undefined ? `; max_write_iops=${roundMetric(writeIopsMetric.max)}` : ""}${writeThroughputMetric?.max !== undefined ? `, max_write_throughput=${roundMetric(writeThroughputMetric.max)}` : ""}.`,
      });
      recommendedNextTools.add("find_top_slow_sql");
      nextToolInputs.push(
        buildFindTopSlowSqlNextToolInput(
          { sortBy: "total_latency", topN: 5 },
          input,
          "Rank the heaviest SQL workload during the lag window to see whether primary-side write pressure is dominating replay.",
        ),
      );
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "replication_lag_evidence_collected",
        title:
          "Replication evidence was collected without a dominant lag signal",
        confidence: "low",
        rationale:
          "Replica status or CES replication metrics were collected, but lag/error thresholds were not crossed.",
      });
    }

    const keyFindings = [
      input.replicaId
        ? `Replica focus provided: ${input.replicaId}.`
        : "No replica identifier was provided.",
      input.channel
        ? `Replication channel provided: ${input.channel}.`
        : "No replication channel was provided.",
      focusedRows.length > 0
        ? `Collected ${focusedRows.length} replication status rows.`
        : "No replication status rows were available.",
      replicationDelayMetric
        ? `CES replication delay: ${metricSummaryText(replicationDelayMetric)}.`
        : "CES replication delay metric was not returned.",
    ];
    if (longTrxMetric) {
      keyFindings.push(
        `CES long transaction count: ${metricSummaryText(longTrxMetric)}.`,
      );
    }
    if (writeIopsMetric) {
      keyFindings.push(
        `CES write IOPS: ${metricSummaryText(writeIopsMetric)}.`,
      );
    }

    const evidence = [
      {
        source: "replication_status",
        title: "Replica status",
        summary:
          focusedRows.length > 0
            ? `Collected ${focusedRows.length} rows; max_status_lag=${maxStatusLag ?? "n/a"} seconds, stopped_or_error_rows=${stoppedRows.length}.`
            : "No rows were returned from SHOW REPLICA STATUS or SHOW SLAVE STATUS.",
      },
      ...metricEvidence,
    ];

    return {
      tool: "diagnose_replication_lag",
      status:
        focusedRows.length > 0 || metrics.length > 0
          ? rootCauseCandidates[0]?.code ===
            "replication_lag_evidence_collected"
            ? "inconclusive"
            : "ok"
          : "not_applicable",
      severity:
        stoppedRows.length > 0 || (maxCesLag ?? maxStatusLag ?? 0) >= 300
          ? "high"
          : (maxCesLag ?? maxStatusLag ?? 0) >= 60
            ? "warning"
            : "info",
      summary: withDatasourceSummary(
        rootCauseCandidates[0]?.code === "replication_lag_evidence_collected"
          ? "Replication-lag diagnosis collected evidence without isolating a dominant lag signal"
          : "Replication-lag diagnosis collected replica and control-plane evidence",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(
        0,
        clampInteger(input.maxCandidates, 3, 1, 10),
      ),
      keyFindings,
      evidence,
      recommendedActions: [
        "Check replica IO/SQL thread state and recent SQL/IO errors before restarting replication components.",
        "Correlate replica lag with primary write spikes, long transactions, and DDL or bulk-load activity.",
        "If CES lag is high but SHOW REPLICA STATUS is unavailable, validate the command on the read-only node or use cloud console replica diagnostics.",
      ],
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(0, 5),
      limitations: [
        ...metricsSourceLimitation(engine.metricsSource),
        "Replica status command availability depends on TaurusDB topology and account privileges.",
      ],
    };
  }
