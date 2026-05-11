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

export async function diagnoseDbHotspot(
  engine: TaurusDBEngine,
  input: DiagnoseDbHotspotInput,
  ctx: SessionContext,
): Promise<DbHotspotResult> {
    const maxCandidates = clampInteger(input.maxCandidates, 5, 1, 10);
    const scope = input.scope ?? "all";
    const hotspots: DbHotspotResult["hotspots"] = [];
    const evidence: DbHotspotResult["evidence"] = [];
    const recommendedNextTools = new Set<string>();
    const nextToolInputs: DiagnosticNextToolInput[] = [];
    const limitations = new Set<string>();

    if (scope === "all" || scope === "sql") {
      const topSlowSql = await engine.findTopSlowSql(
        {
          ...input,
          topN: Math.min(maxCandidates, 5),
          sortBy: "total_latency",
        },
        ctx,
      );
      for (const limitation of topSlowSql.limitations ?? []) {
        limitations.add(limitation);
      }
      if (topSlowSql.status === "ok") {
        for (const sql of topSlowSql.topSqls.slice(
          0,
          Math.min(maxCandidates, 3),
        )) {
          hotspots.push({
            type: "sql",
            title: sql.digestText
              ? `Top SQL hotspot: ${sql.digestText}`
              : "Top SQL hotspot",
            confidence:
              (sql.totalLatencyMs ?? 0) >= 1000 ||
              (sql.avgLatencyMs ?? 0) >= 100
                ? "high"
                : (sql.totalLatencyMs ?? 0) > 0 || (sql.avgLatencyMs ?? 0) > 0
                  ? "medium"
                  : "low",
            sqlHash: sql.sqlHash,
            digestText: sql.digestText,
            sampleSql: sql.sampleSql,
            rationale: `Ranked in digest summaries${sql.totalLatencyMs !== undefined ? `; total_latency_ms=${sql.totalLatencyMs}` : ""}${sql.avgLatencyMs !== undefined ? `, avg_latency_ms=${sql.avgLatencyMs}` : ""}${sql.execCount !== undefined ? `, exec_count=${sql.execCount}` : ""}${sql.avgRowsExamined !== undefined ? `, avg_rows_examined=${sql.avgRowsExamined}` : ""}.`,
            evidenceSources: sql.evidenceSources,
            recommendation:
              sql.recommendation ??
              "Use diagnose_slow_query to inspect the SQL hotspot in more detail.",
          });
          const slowQueryInput = buildSlowQueryNextToolInput(
            sql,
            input,
            "Analyze this SQL hotspot from database-hotspot aggregation.",
          );
          if (slowQueryInput) {
            nextToolInputs.push(slowQueryInput);
          }
        }
        evidence.push(...topSlowSql.evidence.slice(0, 1));
        recommendedNextTools.add("find_top_slow_sql");
        recommendedNextTools.add("diagnose_slow_query");
      }
    }

    if (scope === "all" || scope === "table" || scope === "session") {
      const lockContention = await engine.diagnoseLockContention(
        {
          ...input,
          maxCandidates: Math.min(maxCandidates, 3),
        },
        ctx,
      );
      for (const limitation of lockContention.limitations ?? []) {
        limitations.add(limitation);
      }
      if (lockContention.status === "ok") {
        if (scope === "all" || scope === "session") {
          for (const session of lockContention.suspiciousEntities?.sessions?.slice(
            0,
            2,
          ) ?? []) {
            hotspots.push({
              type: "session",
              title: session.sessionId
                ? `Blocking session hotspot ${session.sessionId}`
                : "Blocking session hotspot",
              confidence: lockContention.rootCauseCandidates.some(
                (candidate) =>
                  candidate.code === "lock_contention_single_blocker_hotspot",
              )
                ? "high"
                : "medium",
              sessionId: session.sessionId,
              rationale: session.reason,
              evidenceSources: ["lock_waits"],
              recommendation:
                "Use diagnose_lock_contention and show_processlist to inspect blocker SQL and transaction age.",
            });
            nextToolInputs.push(
              buildLockContentionNextToolInput(
                { blockerSessionId: session.sessionId },
                input,
                "Inspect this blocking-session hotspot with lock-wait context.",
              ),
              buildShowProcesslistNextToolInput(
                {
                  command: "Query",
                  includeIdle: false,
                  includeInfo: true,
                },
                input,
                "Review live running sessions around this blocking-session hotspot.",
              ),
            );
          }
        }
        if (scope === "all" || scope === "table") {
          for (const table of lockContention.suspiciousEntities?.tables?.slice(
            0,
            2,
          ) ?? []) {
            hotspots.push({
              type: "table",
              title: `Locked table hotspot ${table.table}`,
              confidence: lockContention.rootCauseCandidates.some(
                (candidate) => candidate.code === "lock_contention_hot_table",
              )
                ? "high"
                : "medium",
              table: table.table,
              rationale: table.reason,
              evidenceSources: ["lock_waits"],
              recommendation:
                "Use diagnose_lock_contention to inspect wait chains and reduce lock hold time on this table.",
            });
            nextToolInputs.push(
              buildLockContentionNextToolInput(
                { table: table.table },
                input,
                "Inspect this locked-table hotspot with lock-wait context.",
              ),
            );
          }
        }
        evidence.push(...lockContention.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_lock_contention");
        recommendedNextTools.add("show_processlist");
      }
    }

    if (scope === "all" || scope === "session") {
      const connectionSpike = await engine.diagnoseConnectionSpike(
        {
          ...input,
          compareBaseline: false,
          maxCandidates: Math.min(maxCandidates, 3),
        },
        ctx,
      );
      for (const limitation of connectionSpike.limitations ?? []) {
        limitations.add(limitation);
      }
      if (connectionSpike.status === "ok") {
        const focusUser = connectionSpike.suspiciousEntities?.users?.[0];
        const focusSession = connectionSpike.suspiciousEntities?.sessions?.[0];
        hotspots.push({
          type: "session",
          title: focusUser?.user
            ? `Connection hotspot around user ${focusUser.user}`
            : focusSession?.sessionId
              ? `Connection hotspot around session ${focusSession.sessionId}`
              : "Connection hotspot",
          confidence: connectionSpike.rootCauseCandidates.some(
            (candidate) =>
              candidate.code === "connection_spike_idle_session_accumulation",
          )
            ? "high"
            : "medium",
          sessionId: focusSession?.sessionId,
          rationale:
            focusUser?.reason ??
            focusSession?.reason ??
            "A live processlist snapshot suggests a session-level hotspot around connection growth.",
          evidenceSources: ["processlist"],
          recommendation:
            "Use diagnose_connection_spike and show_processlist to inspect idle buildup and long-running sessions.",
        });
        nextToolInputs.push(
          buildConnectionSpikeNextToolInput(
            {
              user: focusUser?.user,
              clientHost: focusUser?.clientHost,
            },
            input,
            "Inspect this connection hotspot with connection-growth diagnostics.",
          ),
          buildShowProcesslistNextToolInput(
            {
              user: focusUser?.user,
              host: focusUser?.clientHost,
              includeIdle: true,
              includeInfo: true,
            },
            input,
            "Review live sessions for this connection hotspot.",
          ),
        );
        evidence.push(...connectionSpike.evidence.slice(0, 2));
        recommendedNextTools.add("diagnose_connection_spike");
        recommendedNextTools.add("show_processlist");
      }
    }

    const dedupedHotspots = hotspots
      .filter((item, index, allItems) => {
        const key = `${item.type}:${item.sqlHash ?? ""}:${item.digestText ?? ""}:${item.sessionId ?? ""}:${item.table ?? ""}:${item.title}`;
        return (
          allItems.findIndex((candidate) => {
            const candidateKey = `${candidate.type}:${candidate.sqlHash ?? ""}:${candidate.digestText ?? ""}:${candidate.sessionId ?? ""}:${candidate.table ?? ""}:${candidate.title}`;
            return candidateKey === key;
          }) === index
        );
      })
      .sort(
        (left, right) =>
          confidenceWeight(right.confidence) -
            confidenceWeight(left.confidence) ||
          hotspotTypePriority(right.type) - hotspotTypePriority(left.type) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, maxCandidates);

    if (scope === "table") {
      limitations.add(
        "Table hotspots currently rely on lock-wait evidence only; no table-level IO, scan, or storage metric collector is connected yet.",
      );
    }
    if (scope === "session") {
      limitations.add(
        "Session hotspots currently rely on processlist and lock-wait snapshots only; no CPU or per-session resource metric collector is connected yet.",
      );
    }

    return {
      tool: "diagnose_db_hotspot",
      status: dedupedHotspots.length > 0 ? "ok" : "inconclusive",
      summary: withDatasourceSummary(
        dedupedHotspots.length > 0
          ? `Database hotspot diagnosis collected ${dedupedHotspots.length} hotspot candidates`
          : "Database hotspot diagnosis did not isolate a hotspot from current SQL, lock, or processlist evidence",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      scope,
      hotspots: dedupedHotspots,
      evidence: evidence.slice(0, 5),
      recommendedNextTools: [...recommendedNextTools],
      nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(
        0,
        maxCandidates,
      ),
      limitations: [...limitations].slice(0, 5),
    };
  }
