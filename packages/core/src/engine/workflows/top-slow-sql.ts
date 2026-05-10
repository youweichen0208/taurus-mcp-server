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

export async function findTopSlowSql(
  engine: TaurusDBEngine,
  input: FindTopSlowSqlInput,
  ctx: SessionContext,
): Promise<FindTopSlowSqlResult> {
    try {
      const [digestRows, externalTopSqls] = await Promise.all([
        engine.findTopStatementDigests(input, ctx).catch(
          () => [] as StatementDigestRow[],
        ),
        engine.slowSqlSource?.findTop
          ? engine.slowSqlSource.findTop(input, ctx).catch(() => [])
          : Promise.resolve([] as ExternalSlowSqlSample[]),
      ]);

      if (digestRows.length === 0 && externalTopSqls.length === 0) {
        const performanceSchemaEnabled =
          await engine.isPerformanceSchemaEnabled(ctx);
        return {
          tool: "find_top_slow_sql",
          status: "inconclusive",
          summary: withDatasourceSummary(
            performanceSchemaEnabled === false
              ? "Top slow SQL discovery could not collect local digest evidence because performance_schema is disabled"
              : "No statement digest ranking evidence was available for top slow SQL discovery",
            ctx.datasource,
          ),
          diagnosisWindow: {
            from: input.timeRange?.from,
            to: input.timeRange?.to,
            relative: input.timeRange?.relative,
          },
          topSqls: [],
          evidence: [
            {
              source: "statement_digest",
              title: "Statement digest ranking",
              summary:
                performanceSchemaEnabled === false
                  ? "performance_schema is disabled on the selected datasource. performance_schema.events_statements_summary_by_digest is therefore unavailable for local slow-SQL digest discovery."
                  : "No matching rows were returned from performance_schema.events_statements_summary_by_digest, and no external Taurus slow-SQL ranking was available.",
            },
          ],
          limitations: [
            performanceSchemaEnabled === false
              ? "performance_schema is currently disabled. Enable it and repopulate statement activity if you want local digest-based slow SQL discovery."
              : engine.slowSqlSource?.findTop
                ? "Neither performance_schema digest ranking nor the configured external Taurus slow-SQL ranking returned usable rows."
                : "This discovery currently depends on performance_schema digest summaries being enabled and populated.",
            "The selected time_range is not yet enforced against cumulative digest counters; current ranking reflects retained digest summaries.",
          ],
        };
      }

      const digestTopSqls = digestRows.map((row) => {
        const evidenceSources = ["statement_digest"];
        const recommendationParts = [];
        if (row.querySampleText || row.digestText) {
          recommendationParts.push(
            "Run diagnose_slow_query with sql or digest_text to analyze the dominant bottleneck.",
          );
        }
        if ((row.avgLockTimeMs ?? 0) >= 10) {
          recommendationParts.push(
            "Correlate with diagnose_lock_contention if lock time remains elevated.",
          );
        }
        if ((row.execCount ?? 0) >= 20 && (row.avgLatencyMs ?? 0) < 50) {
          recommendationParts.push(
            "Review high-frequency workload shape before focusing only on single-query latency.",
          );
        }

        return {
          sqlHash: row.querySampleText
            ? sqlHash(normalizeSql(row.querySampleText))
            : undefined,
          digestText: row.digestText,
          sampleSql: row.querySampleText,
          avgLatencyMs: row.avgLatencyMs,
          totalLatencyMs: row.totalLatencyMs,
          execCount: row.execCount,
          avgLockTimeMs: row.avgLockTimeMs,
          avgRowsExamined: row.avgRowsExamined,
          evidenceSources,
          recommendation:
            recommendationParts.length > 0
              ? recommendationParts.join(" ")
              : "Review this digest with diagnose_slow_query if it aligns with the reported symptom window.",
        };
      });
      const externalMappedSqls = externalTopSqls.map((sample) => {
        const recommendationParts = [
          "Run diagnose_slow_query with sql or digest_text to analyze the dominant bottleneck.",
        ];
        if ((sample.avgLockTimeMs ?? 0) >= 10) {
          recommendationParts.push(
            "Correlate with diagnose_lock_contention if lock time remains elevated.",
          );
        }
        if ((sample.execCount ?? 0) >= 20 && (sample.avgLatencyMs ?? 0) < 50) {
          recommendationParts.push(
            "Review high-frequency workload shape before focusing only on single-query latency.",
          );
        }
        return {
          sqlHash: sample.sqlHash,
          digestText: sample.digestText,
          sampleSql: sample.sql,
          avgLatencyMs: sample.avgLatencyMs,
          totalLatencyMs:
            sample.avgLatencyMs !== undefined
              ? sample.avgLatencyMs * Math.max(sample.execCount ?? 1, 1)
              : undefined,
          execCount: sample.execCount,
          avgLockTimeMs: sample.avgLockTimeMs,
          avgRowsExamined: sample.avgRowsExamined,
          evidenceSources: [sample.source],
          recommendation: recommendationParts.join(" "),
        };
      });
      const mergedTopSqls = [...digestTopSqls];
      for (const externalSql of externalMappedSqls) {
        const existingIndex = mergedTopSqls.findIndex(
          (item) =>
            (externalSql.sqlHash && item.sqlHash === externalSql.sqlHash) ||
            (externalSql.digestText &&
              item.digestText === externalSql.digestText) ||
            (externalSql.sampleSql && item.sampleSql === externalSql.sampleSql),
        );
        if (existingIndex >= 0) {
          const existing = mergedTopSqls[existingIndex];
          mergedTopSqls[existingIndex] = {
            ...existing,
            sampleSql: existing.sampleSql ?? externalSql.sampleSql,
            avgLatencyMs: existing.avgLatencyMs ?? externalSql.avgLatencyMs,
            totalLatencyMs:
              existing.totalLatencyMs ?? externalSql.totalLatencyMs,
            execCount: existing.execCount ?? externalSql.execCount,
            avgLockTimeMs:
              existing.avgLockTimeMs ?? externalSql.avgLockTimeMs,
            avgRowsExamined:
              existing.avgRowsExamined ?? externalSql.avgRowsExamined,
            evidenceSources: [
              ...new Set([
                ...existing.evidenceSources,
                ...externalSql.evidenceSources,
              ]),
            ],
          };
        } else {
          mergedTopSqls.push(externalSql);
        }
      }
      const topSqls = mergedTopSqls
        .sort((left, right) => {
          const leftAvgLatency = left.avgLatencyMs ?? 0;
          const rightAvgLatency = right.avgLatencyMs ?? 0;
          const leftTotalLatency = left.totalLatencyMs ?? 0;
          const rightTotalLatency = right.totalLatencyMs ?? 0;
          const leftExecCount = left.execCount ?? 0;
          const rightExecCount = right.execCount ?? 0;
          const leftLockTime = left.avgLockTimeMs ?? 0;
          const rightLockTime = right.avgLockTimeMs ?? 0;
          switch (input.sortBy) {
            case "avg_latency":
              return (
                rightAvgLatency - leftAvgLatency ||
                rightTotalLatency - leftTotalLatency
              );
            case "exec_count":
              return (
                rightExecCount - leftExecCount ||
                rightTotalLatency - leftTotalLatency
              );
            case "lock_time":
              return (
                rightLockTime - leftLockTime ||
                rightTotalLatency - leftTotalLatency
              );
            default:
              return (
                rightTotalLatency - leftTotalLatency ||
                rightAvgLatency - leftAvgLatency
              );
          }
        })
        .slice(0, clampInteger(input.topN, 5, 1, 20));

      return {
        tool: "find_top_slow_sql",
        status: "ok",
        summary: withDatasourceSummary(
          `Top slow SQL discovery collected ${topSqls.length} suspect statements`,
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        topSqls,
        evidence: [
          ...(digestRows.length > 0
            ? [
                {
                  source: "statement_digest",
                  title: "Statement digest ranking",
                  summary: `Collected ${digestRows.length} ranked rows from performance_schema.events_statements_summary_by_digest ordered by ${input.sortBy ?? "total_latency"}.`,
                },
              ]
            : []),
          ...(externalTopSqls.length > 0
            ? [
                {
                  source: externalTopSqls[0].source,
                  title: "External Taurus slow SQL ranking",
                  summary: `Collected ${externalTopSqls.length} ranked rows from the configured Taurus slow-SQL source ordered by ${input.sortBy ?? "total_latency"}.`,
                  rawRef: externalTopSqls[0].rawRef,
                },
              ]
            : []),
        ],
        limitations: [
          ...(digestRows.length > 0
            ? [
                "The selected time_range is not yet enforced against cumulative digest counters; current ranking reflects retained digest summaries.",
              ]
            : []),
          ...(externalTopSqls.length > 0
            ? [
                "External Taurus slow-SQL ranking depends on the configured API retention window and may not cover every statement in the requested time range.",
              ]
            : []),
        ],
      };
    } catch (error) {
      return {
        tool: "find_top_slow_sql",
        status: "inconclusive",
        summary: withDatasourceSummary(
          "Top slow SQL discovery could not collect digest ranking evidence",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        topSqls: [],
        evidence: [
          {
            source: "statement_digest",
            title: "Statement digest ranking unavailable",
            summary:
              error instanceof Error
                ? error.message
                : "Digest ranking query failed unexpectedly.",
          },
        ],
        limitations: [
          "This discovery currently depends on performance_schema digest summaries being accessible from the selected datasource.",
        ],
      };
    }
  }
