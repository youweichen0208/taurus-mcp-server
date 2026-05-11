import { UnsupportedFeatureError } from "../../capability/types.js";
import type { SessionContext } from "../../context/session-context.js";
import {
  createPlaceholderDiagnosticResult,
  type DbHotspotResult,
  type DiagnoseConnectionSpikeInput,
  type DiagnoseDbHotspotInput,
  type DiagnoseLockContentionInput,
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

export async function diagnoseServiceLatency(
  engine: TaurusDBEngine,
  input: DiagnoseServiceLatencyInput,
  ctx: SessionContext,
): Promise<ServiceLatencyResult> {
    const maxCandidates = clampInteger(input.maxCandidates, 5, 1, 10);
    const [topSlowSql, lockContention, connectionSpike, metrics] =
      await Promise.all([
        engine.findTopSlowSql(
          {
            ...input,
            topN: Math.min(maxCandidates, 5),
            sortBy:
              input.symptom === "latency" || input.symptom === "timeout"
                ? "avg_latency"
                : "total_latency",
          },
          ctx,
        ),
        input.symptom === "connection_growth"
          ? Promise.resolve(undefined)
          : engine.diagnoseLockContention(
              {
                ...input,
                maxCandidates: Math.min(maxCandidates, 3),
              },
              ctx,
            ),
        engine.diagnoseConnectionSpike(
          {
            ...input,
            user: input.user,
            clientHost: input.clientHost,
            compareBaseline: false,
            maxCandidates: Math.min(maxCandidates, 3),
          },
          ctx,
        ),
        queryMetricsSafely(
          engine.metricsSource,
          [
            "cpu_util",
            "mem_util",
            "connection_usage",
            "qps",
            "slow_queries",
            "storage_write_delay",
            "storage_read_delay",
          ],
          input,
          ctx,
        ),
      ]);
    const cpuMetric = pickMetric(metrics, "cpu_util");
    const memMetric = pickMetric(metrics, "mem_util");
    const connectionUsageMetric = pickMetric(metrics, "connection_usage");
    const slowQueriesMetric = pickMetric(metrics, "slow_queries");
    const writeDelayMetric = pickMetric(metrics, "storage_write_delay");
    const readDelayMetric = pickMetric(metrics, "storage_read_delay");

    const topCandidates: ServiceLatencyCandidate[] = [];
    const evidence: ServiceLatencyResult["evidence"] = [];
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];
    const limitations = new Set<string>();
    const categoryScores = new Map<ServiceLatencySuspectedCategory, number>();

    const scoreCategory = (
      category: ServiceLatencySuspectedCategory,
      score: number,
    ) => {
      categoryScores.set(
        category,
        Math.max(categoryScores.get(category) ?? 0, score),
      );
    };

    if (topSlowSql.status === "ok" && topSlowSql.topSqls.length > 0) {
      const leadSql = topSlowSql.topSqls[0];
      const sqlConfidence: ServiceLatencyCandidate["confidence"] =
        (leadSql.totalLatencyMs ?? 0) >= 1000 ||
        (leadSql.avgLatencyMs ?? 0) >= 100
          ? "high"
          : (leadSql.totalLatencyMs ?? 0) > 0 || (leadSql.avgLatencyMs ?? 0) > 0
            ? "medium"
            : "low";

      topCandidates.push({
        type: "sql",
        title: leadSql.digestText
          ? `Top ranked SQL digest: ${leadSql.digestText}`
          : "Top ranked SQL digest",
        confidence: sqlConfidence,
        sqlHash: leadSql.sqlHash,
        digestText: leadSql.digestText,
        sampleSql: leadSql.sampleSql,
        rationale: `Ranked near the top of statement digest summaries${leadSql.avgLatencyMs !== undefined ? `; avg_latency_ms=${leadSql.avgLatencyMs}` : ""}${leadSql.totalLatencyMs !== undefined ? `, total_latency_ms=${leadSql.totalLatencyMs}` : ""}${leadSql.execCount !== undefined ? `, exec_count=${leadSql.execCount}` : ""}${leadSql.avgRowsExamined !== undefined ? `, avg_rows_examined=${leadSql.avgRowsExamined}` : ""}.`,
      });
      const slowQueryInput = buildSlowQueryNextToolInput(
        leadSql,
        input,
        "Analyze the top-ranked SQL candidate from the service-latency symptom route.",
      );
      if (slowQueryInput) {
        nextToolInputs.push(slowQueryInput);
      }
      evidence.push(...topSlowSql.evidence.slice(0, 1));
      recommendedNextTools.add("diagnose_slow_query");
      if ((leadSql.avgLockTimeMs ?? 0) >= 10) {
        recommendedNextTools.add("diagnose_lock_contention");
      }

      scoreCategory(
        "slow_sql",
        input.symptom === "cpu"
          ? 4
          : input.symptom === "latency" || input.symptom === "timeout"
            ? 3
            : 2,
      );
    }
    for (const limitation of topSlowSql.limitations ?? []) {
      limitations.add(limitation);
    }

    if (lockContention) {
      for (const limitation of lockContention.limitations ?? []) {
        limitations.add(limitation);
      }
      if (lockContention.status === "ok") {
        const leadBlocker = lockContention.suspiciousEntities?.sessions?.[0];
        const leadTable = lockContention.suspiciousEntities?.tables?.[0];
        const leadRootCause = lockContention.rootCauseCandidates[0];

        if (leadBlocker) {
          topCandidates.push({
            type: "session",
            title: leadBlocker.sessionId
              ? `Blocking session ${leadBlocker.sessionId}`
              : "Blocking session hotspot",
            confidence: leadRootCause?.confidence ?? "medium",
            sessionId: leadBlocker.sessionId,
            rationale: leadBlocker.reason,
          });
        }
        if (leadTable) {
          topCandidates.push({
            type: "table",
            title: `Hot locked table ${leadTable.table}`,
            confidence: lockContention.rootCauseCandidates.some(
              (candidate) => candidate.code === "lock_contention_hot_table",
            )
              ? "high"
              : (leadRootCause?.confidence ?? "medium"),
            table: leadTable.table,
            rationale: leadTable.reason,
          });
        }

        evidence.push(...lockContention.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_lock_contention");
        recommendedNextTools.add("show_processlist");
        nextToolInputs.push(
          buildLockContentionNextToolInput(
            {
              table: leadTable?.table,
              blockerSessionId: leadBlocker?.sessionId,
            },
            input,
            "Inspect the lock-wait candidate identified by the service-latency symptom route.",
          ),
          buildShowProcesslistNextToolInput(
            {
              command: "Query",
              includeIdle: false,
              includeInfo: true,
            },
            input,
            "Review live running sessions around the lock-contention signal.",
          ),
        );

        const lockScoreBase =
          input.symptom === "timeout" ? 5 : input.symptom === "latency" ? 4 : 2;
        scoreCategory(
          "lock_contention",
          lockContention.rootCauseCandidates.some(
            (candidate) =>
              candidate.code === "lock_contention_single_blocker_hotspot",
          )
            ? lockScoreBase + 1
            : lockScoreBase,
        );
      }
    }

    for (const limitation of connectionSpike.limitations ?? []) {
      limitations.add(limitation);
    }
    if (connectionSpike.status === "ok") {
      const focusUser = connectionSpike.suspiciousEntities?.users?.[0];
      const focusSession = connectionSpike.suspiciousEntities?.sessions?.[0];
      const leadRootCause = connectionSpike.rootCauseCandidates[0];
      topCandidates.push({
        type: "session",
        title: focusUser?.user
          ? `Connection growth around user ${focusUser.user}`
          : focusSession?.sessionId
            ? `Connection growth around session ${focusSession.sessionId}`
            : "Connection growth hotspot",
        confidence: leadRootCause?.confidence ?? "medium",
        sessionId: focusSession?.sessionId,
        rationale:
          focusUser?.reason ??
          focusSession?.reason ??
          "A live processlist snapshot suggests connection growth around a focused user or long-running sessions.",
      });
      evidence.push(...connectionSpike.evidence.slice(0, 2));
      recommendedNextTools.add("diagnose_connection_spike");
      recommendedNextTools.add("show_processlist");
      nextToolInputs.push(
        buildConnectionSpikeNextToolInput(
          {
            user: focusUser?.user ?? input.user,
            clientHost: focusUser?.clientHost ?? input.clientHost,
          },
          input,
          "Inspect the connection-growth candidate identified by the service-latency symptom route.",
        ),
        buildShowProcesslistNextToolInput(
          {
            user: focusUser?.user ?? input.user,
            host: focusUser?.clientHost ?? input.clientHost,
            includeIdle: true,
            includeInfo: true,
          },
          input,
          "Review live sessions for idle buildup or long-running queries around the connection signal.",
        ),
      );

      const connectionScoreBase =
        input.symptom === "connection_growth"
          ? 5
          : input.symptom === "latency" || input.symptom === "timeout"
            ? 2
            : 1;
      scoreCategory(
        "connection_spike",
        connectionSpike.rootCauseCandidates.some(
          (candidate) =>
            candidate.code === "connection_spike_idle_session_accumulation",
        )
          ? connectionScoreBase + 1
          : connectionScoreBase,
      );
    }

    if (metrics.length > 0) {
      evidence.push(
        ...metrics.slice(0, 4).map((metric) => ({
          source: "ces_metrics",
          title: `CES ${metric.alias}`,
          summary: metricSummaryText(metric),
        })),
      );
      if ((cpuMetric?.max ?? 0) >= 80 || (memMetric?.max ?? 0) >= 90) {
        topCandidates.push({
          type: "session",
          title: "Instance resource pressure from CES metrics",
          confidence:
            (cpuMetric?.max ?? 0) >= 90 || (memMetric?.max ?? 0) >= 95
              ? "high"
              : "medium",
          rationale: `Cloud Eye metrics show instance resource pressure${cpuMetric?.max !== undefined ? `; max_cpu=${roundMetric(cpuMetric.max)}` : ""}${memMetric?.max !== undefined ? `, max_mem=${roundMetric(memMetric.max)}` : ""}.`,
        });
        recommendedNextTools.add("diagnose_storage_pressure");
        scoreCategory("resource_pressure", input.symptom === "cpu" ? 6 : 3);
      }
      if (
        (writeDelayMetric?.max ?? 0) >= 50 ||
        (readDelayMetric?.max ?? 0) >= 50
      ) {
        recommendedNextTools.add("diagnose_storage_pressure");
        scoreCategory("resource_pressure", 4);
      }
      if ((connectionUsageMetric?.max ?? 0) >= 80) {
        recommendedNextTools.add("diagnose_connection_spike");
        scoreCategory(
          "connection_spike",
          input.symptom === "connection_growth" ? 6 : 3,
        );
      }
      if ((slowQueriesMetric?.max ?? 0) > 0) {
        recommendedNextTools.add("find_top_slow_sql");
        recommendedNextTools.add("diagnose_slow_query");
        scoreCategory("slow_sql", input.symptom === "latency" ? 4 : 2);
      }
    } else {
      for (const limitation of metricsSourceLimitation(engine.metricsSource)) {
        limitations.add(limitation);
      }
    }

    const scoredCategories = [...categoryScores.entries()]
      .filter(([, score]) => score > 0)
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          serviceCategoryPriority(right[0]) - serviceCategoryPriority(left[0]),
      );

    const fallbackCategory: ServiceLatencySuspectedCategory =
      input.symptom === "cpu"
        ? "resource_pressure"
        : input.symptom === "connection_growth"
          ? "connection_spike"
          : input.symptom === "timeout"
            ? "lock_contention"
            : "slow_sql";

    const suspectedCategory =
      scoredCategories.length === 0
        ? fallbackCategory
        : scoredCategories.length > 1 &&
            scoredCategories[0][1] === scoredCategories[1][1]
          ? "mixed"
          : scoredCategories[0][0];

    if (suspectedCategory === "resource_pressure") {
      recommendedNextTools.add("diagnose_storage_pressure");
      if (!engine.metricsSource) {
        limitations.add(
          "Resource-pressure routing is heuristic because no CPU, IOPS, or instance-metric collector is configured yet.",
        );
      }
    }

    const sortedCandidates = [...topCandidates]
      .sort(
        (left, right) =>
          confidenceWeight(right.confidence) -
            confidenceWeight(left.confidence) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, maxCandidates);

    const summary =
      sortedCandidates.length > 0
        ? suspectedCategory === "mixed"
          ? "Service-latency diagnosis found mixed SQL, lock, or connection signals"
          : `Service-latency diagnosis points to ${suspectedCategory.replace(/_/g, " ")} as the dominant suspect`
        : "Service-latency diagnosis did not isolate a dominant suspect from current SQL, lock, or connection evidence";

    return {
      tool: "diagnose_service_latency",
      status: sortedCandidates.length > 0 ? "ok" : "inconclusive",
      summary: withDatasourceSummary(summary, ctx.datasource),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      suspectedCategory,
      topCandidates: sortedCandidates,
      evidence: evidence.slice(0, 5),
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(
        0,
        maxCandidates,
      ),
      limitations: [...limitations].slice(0, 5),
    };
  }
