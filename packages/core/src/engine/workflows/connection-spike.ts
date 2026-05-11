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

export async function diagnoseConnectionSpike(
  engine: TaurusDBEngine,
  input: DiagnoseConnectionSpikeInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
    const [processlist, metrics] = await Promise.all([
      engine.showProcesslist(
        {
          user: input.user,
          host: input.clientHost,
          includeIdle: true,
          includeSystem: false,
          includeInfo: false,
          maxRows: evidenceRowLimit(input.evidenceLevel),
        },
        ctx,
      ),
      queryMetricsSafely(
        engine.metricsSource,
        [
          "connection_count",
          "active_connection_count",
          "connection_usage",
          "qps",
        ],
        input,
        ctx,
      ),
    ]);
    const rows = parseProcesslistRows(processlist);
    const connectionCountMetric = pickMetric(metrics, "connection_count");
    const activeConnectionMetric = pickMetric(
      metrics,
      "active_connection_count",
    );
    const connectionUsageMetric = pickMetric(metrics, "connection_usage");
    const qpsMetric = pickMetric(metrics, "qps");
    const metricEvidence = metrics.map((metric) => ({
      source: "ces_metrics",
      title: `CES ${metric.alias}`,
      summary: metricSummaryText(metric),
    }));

    if (rows.length === 0) {
      const metricOnlySpike =
        (connectionUsageMetric?.max ?? 0) >= 80 ||
        (connectionCountMetric?.max ?? 0) >= 100 ||
        (activeConnectionMetric?.max ?? 0) >= 50;
      if (metricOnlySpike) {
        return {
          tool: "diagnose_connection_spike",
          status: "ok",
          severity:
            (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "warning",
          summary: withDatasourceSummary(
            "Connection-spike diagnosis found CES connection pressure but no matching live sessions",
            ctx.datasource,
          ),
          diagnosisWindow: {
            from: input.timeRange?.from,
            to: input.timeRange?.to,
            relative: input.timeRange?.relative,
          },
          rootCauseCandidates: [
            {
              code: "connection_spike_ces_connection_pressure",
              title: "Control-plane metrics show connection pressure",
              confidence:
                (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "medium",
              rationale: `CES connection metrics crossed the current thresholds${connectionUsageMetric?.max !== undefined ? `; max_connection_usage=${roundMetric(connectionUsageMetric.max)}` : ""}${connectionCountMetric?.max !== undefined ? `, max_connection_count=${roundMetric(connectionCountMetric.max)}` : ""}${activeConnectionMetric?.max !== undefined ? `, max_active_connections=${roundMetric(activeConnectionMetric.max)}` : ""}.`,
            },
          ],
          keyFindings: [
            "No matching processlist rows were available in the current snapshot.",
            connectionUsageMetric
              ? `CES connection usage: ${metricSummaryText(connectionUsageMetric)}.`
              : "CES connection usage metric was not returned.",
            connectionCountMetric
              ? `CES connection count: ${metricSummaryText(connectionCountMetric)}.`
              : "CES connection count metric was not returned.",
          ],
          suspiciousEntities: input.user
            ? {
                users: [
                  {
                    user: input.user,
                    clientHost: input.clientHost,
                    reason:
                      "Provided as the diagnosis focus; CES showed connection pressure but the live snapshot did not contain matching sessions.",
                  },
                ],
              }
            : undefined,
          evidence: [
            {
              source: "processlist",
              title: "Current processlist snapshot",
              summary:
                "No matching sessions were returned from information_schema.PROCESSLIST.",
            },
            ...metricEvidence,
          ],
          recommendedActions: [
            "Re-run show_processlist during the spike window with include_idle=true and include_info=true.",
            "Correlate CES connection pressure with application deploys, retry storms, and pool-size settings.",
          ],
          limitations: [
            "Live processlist evidence was not available for the observed CES spike window.",
          ],
        };
      }
      return {
        tool: "diagnose_connection_spike",
        status: "inconclusive",
        severity: "info",
        summary: withDatasourceSummary(
          "No matching processlist sessions were observed for connection-spike diagnosis",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "connection_spike_no_matching_sessions",
            title: "No matching live sessions observed",
            confidence: "low",
            rationale:
              "The current processlist snapshot did not contain sessions matching the requested user or client-host filters.",
          },
        ],
        keyFindings: [
          input.user
            ? `No current processlist rows matched user ${input.user}.`
            : "No current processlist rows were returned.",
          input.clientHost
            ? `No current processlist rows matched host prefix ${input.clientHost}.`
            : "No host filter was applied.",
        ],
        suspiciousEntities: input.user
          ? {
              users: [
                {
                  user: input.user,
                  clientHost: input.clientHost,
                  reason:
                    "Provided as the diagnosis focus, but no matching live sessions were observed in the current snapshot.",
                },
              ],
            }
          : undefined,
        evidence: [
          {
            source: "processlist",
            title: "Current processlist snapshot",
            summary:
              "No matching sessions were returned from information_schema.PROCESSLIST.",
          },
          ...metricEvidence,
        ],
        recommendedActions: [
          "Re-run the diagnostic during the spike window to capture live sessions.",
          "Use show_processlist with broader filters or include_idle=true to inspect connection buildup.",
        ],
        limitations: [
          "This diagnostic currently uses a point-in-time processlist snapshot only.",
          ...metricsSourceLimitation(engine.metricsSource),
        ],
      };
    }

    const sleepSessions = rows.filter((row) => row.command === "Sleep");
    const activeSessions = rows.filter((row) => row.command !== "Sleep");
    const longRunningSessions = rows.filter(
      (row) => (row.timeSeconds ?? 0) >= 60,
    );
    const userCounts = countBy(rows, (row) => row.user);
    const hostCounts = countBy(rows, (row) => row.host);
    const topUser = userCounts[0];
    const topHost = hostCounts[0];
    const longestSessions = [...rows]
      .sort((left, right) => (right.timeSeconds ?? 0) - (left.timeSeconds ?? 0))
      .slice(0, 3);

    const rootCauseCandidates: DiagnosticResult["rootCauseCandidates"] = [];
    if (sleepSessions.length >= Math.max(5, Math.ceil(rows.length * 0.6))) {
      rootCauseCandidates.push({
        code: "connection_spike_idle_session_accumulation",
        title: "Idle session accumulation",
        confidence: rows.length >= 10 ? "high" : "medium",
        rationale: `${sleepSessions.length} of ${rows.length} matching sessions are idle (Sleep), which usually points to pooling saturation or clients holding connections open.`,
      });
    }
    if (activeSessions.length >= Math.max(3, Math.ceil(rows.length * 0.4))) {
      rootCauseCandidates.push({
        code: "connection_spike_active_query_backlog",
        title: "Active query backlog",
        confidence: activeSessions.length >= 8 ? "high" : "medium",
        rationale: `${activeSessions.length} matching sessions are active, suggesting requests may be piling up behind slow or blocked work.`,
      });
    }
    if (topUser && topUser.count >= Math.max(3, Math.ceil(rows.length * 0.5))) {
      rootCauseCandidates.push({
        code: "connection_spike_single_user_hotspot",
        title: "Single-user hotspot",
        confidence: topUser.count >= 8 ? "high" : "medium",
        rationale: `User ${topUser.key} accounts for ${topUser.count} of ${rows.length} matching sessions, which suggests a concentrated source of connection growth.`,
      });
    }
    if (longRunningSessions.length > 0) {
      rootCauseCandidates.push({
        code: "connection_spike_long_running_sessions",
        title: "Long-running sessions are holding connections",
        confidence: longRunningSessions.length >= 3 ? "high" : "medium",
        rationale: `${longRunningSessions.length} matching sessions have been active for at least 60 seconds, which can reduce pool turnover and amplify connection growth.`,
      });
    }
    if (
      (connectionUsageMetric?.max ?? 0) >= 80 ||
      (connectionCountMetric?.max ?? 0) >= 100
    ) {
      rootCauseCandidates.push({
        code: "connection_spike_ces_connection_pressure",
        title: "CES metrics confirm connection pressure",
        confidence: (connectionUsageMetric?.max ?? 0) >= 90 ? "high" : "medium",
        rationale: `Cloud Eye connection metrics crossed the current pressure thresholds${connectionUsageMetric?.max !== undefined ? `; max_connection_usage=${roundMetric(connectionUsageMetric.max)}` : ""}${connectionCountMetric?.max !== undefined ? `, max_connection_count=${roundMetric(connectionCountMetric.max)}` : ""}.`,
      });
    }
    if (rootCauseCandidates.length === 0) {
      rootCauseCandidates.push({
        code: "connection_spike_snapshot_collected",
        title: "Connection spike snapshot collected",
        confidence: "low",
        rationale:
          "A live processlist snapshot was collected, but no single dominant pattern crossed the current heuristic thresholds.",
      });
    }

    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const severity: DiagnosticResult["severity"] =
      rows.length >= 40 ||
      activeSessions.length >= 15 ||
      longRunningSessions.length >= 5
        ? "high"
        : rows.length >= 15 ||
            activeSessions.length >= 5 ||
            longRunningSessions.length >= 2
          ? "warning"
          : "info";

    const suspiciousUsers = [];
    if (input.user) {
      suspiciousUsers.push({
        user: input.user,
        clientHost: input.clientHost,
        reason: "Provided as the connection-spike focus.",
      });
    } else if (topUser) {
      suspiciousUsers.push({
        user: topUser.key,
        clientHost: topHost?.key,
        reason: `Top user in current processlist snapshot with ${topUser.count} sessions.`,
      });
    }

    const suspiciousSessions = longestSessions.map((row) => ({
      sessionId: row.sessionId,
      user: row.user,
      state: row.state ?? row.command,
      reason:
        row.timeSeconds !== undefined
          ? `Observed in the longest-running processlist sessions (${row.timeSeconds}s).`
          : "Observed in the current processlist snapshot.",
    }));

    const keyFindings = [
      `Collected ${rows.length} matching processlist sessions (${activeSessions.length} active, ${sleepSessions.length} idle).`,
      topUser
        ? `Top user ${topUser.key} accounts for ${topUser.count} sessions.`
        : "No dominant user was identified in the current snapshot.",
      longRunningSessions.length > 0
        ? `${longRunningSessions.length} sessions have been active for at least 60 seconds.`
        : "No long-running sessions (>=60s) were observed in the current snapshot.",
    ];
    if (input.compareBaseline) {
      keyFindings.push(
        engine.metricsSource
          ? "Baseline comparison was requested; CES connection metrics were collected for the requested time window."
          : "Baseline comparison was requested, but only a live processlist snapshot is currently available.",
      );
    }
    if (connectionUsageMetric) {
      keyFindings.push(
        `CES connection usage: ${metricSummaryText(connectionUsageMetric)}.`,
      );
    }
    if (connectionCountMetric) {
      keyFindings.push(
        `CES connection count: ${metricSummaryText(connectionCountMetric)}.`,
      );
    }
    if (activeConnectionMetric) {
      keyFindings.push(
        `CES active connections: ${metricSummaryText(activeConnectionMetric)}.`,
      );
    }
    if (qpsMetric) {
      keyFindings.push(`CES QPS: ${metricSummaryText(qpsMetric)}.`);
    }

    const recommendedActions = [
      "Use show_processlist with include_info=true to inspect the longest-running sessions in more detail.",
      "Correlate the snapshot with application deploys, retry storms, and pool-size settings.",
    ];
    if (sleepSessions.length >= Math.max(5, Math.ceil(rows.length * 0.6))) {
      recommendedActions.push(
        "Inspect client pooling, idle timeout, and connection reuse behavior for excessive Sleep sessions.",
      );
    }
    if (activeSessions.length >= Math.max(3, Math.ceil(rows.length * 0.4))) {
      recommendedActions.push(
        "Review slow or blocked active sessions with explain_sql / explain_sql_enhanced and lock diagnostics.",
      );
    }
    if ((connectionUsageMetric?.max ?? 0) >= 80) {
      recommendedActions.push(
        "Check configured max connections and application pool concurrency because CES connection usage crossed 80%.",
      );
    }

    const evidence = [
      {
        source: "processlist",
        title: "Current processlist snapshot",
        summary: `Snapshot captured ${rows.length} matching sessions, including ${activeSessions.length} active and ${sleepSessions.length} idle sessions.`,
      },
      {
        source: "processlist",
        title: "Dominant user and host distribution",
        summary:
          topUser || topHost
            ? `Top user: ${topUser?.key ?? "n/a"} (${topUser?.count ?? 0}); top host: ${topHost?.key ?? "n/a"} (${topHost?.count ?? 0}).`
            : "No dominant user or host distribution was identified.",
      },
      ...metricEvidence,
    ];

    return {
      tool: "diagnose_connection_spike",
      status: "ok",
      severity,
      summary: withDatasourceSummary(
        `Connection-spike diagnosis collected a live processlist snapshot with ${rows.length} matching sessions`,
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities:
        suspiciousUsers.length > 0 || suspiciousSessions.length > 0
          ? {
              users: suspiciousUsers.length > 0 ? suspiciousUsers : undefined,
              sessions:
                suspiciousSessions.length > 0 ? suspiciousSessions : undefined,
            }
          : undefined,
      evidence,
      recommendedActions: [...new Set(recommendedActions)],
      limitations: [
        "This diagnostic currently relies on a point-in-time processlist snapshot only.",
        ...metricsSourceLimitation(engine.metricsSource),
      ],
    };
  }
