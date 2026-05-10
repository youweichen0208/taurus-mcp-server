import type { SessionContext } from "../../context/session-context.js";
import {
  type DiagnoseSlowQueryInput,
  type DiagnosticResult,
} from "../../diagnostics/types.js";
import { buildResolveSlowSqlInput } from "../../diagnostics/slow-sql-source.js";
import type { TaurusDBEngine } from "../../engine.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import {
  clampInteger,
  severityFromSlowQueryEvidence,
  sortRootCauseCandidates,
  withDatasourceSummary,
} from "../helpers.js";
import {
  buildSlowQueryEvidence,
  buildSlowQueryKeyFindings,
  buildSlowQueryRecommendedActions,
  buildSlowQueryRootCauseCandidates,
  collectPlanTableStats,
} from "./slow-query-helpers.js";

export async function diagnoseSlowQuery(
  engine: TaurusDBEngine,
  input: DiagnoseSlowQueryInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
    const sqlMatchedDigestSample = input.sql
      ? await engine.findStatementDigestSampleForSql(input.sql, ctx)
      : undefined;
    const externalSlowSqlSample =
      !input.sql && engine.slowSqlSource
        ? await engine.slowSqlSource.resolve(buildResolveSlowSqlInput(input), ctx)
        : undefined;
    const digestSample =
      sqlMatchedDigestSample ??
      (!input.sql && input.digestText
        ? await engine.findStatementDigestSample(input.digestText, ctx)
        : undefined);
    const waitEventRows =
      input.digestText || digestSample?.digestText
        ? await engine.findStatementWaitEvents(
            input.digestText ?? digestSample?.digestText ?? "",
            ctx,
          )
        : [];
    const effectiveSql =
      input.sql ?? externalSlowSqlSample?.sql ?? digestSample?.querySampleText;
    const derivedSqlHash = effectiveSql
      ? sqlHash(normalizeSql(effectiveSql))
      : undefined;
    const runtimeLockTimeMs =
      digestSample?.avgLockTimeMs ?? externalSlowSqlSample?.avgLockTimeMs;
    const runtimeRowsExamined =
      digestSample?.avgRowsExamined ?? externalSlowSqlSample?.avgRowsExamined;
    const suspiciousSql =
      effectiveSql || input.sqlHash || input.digestText
        ? [
            {
              sqlHash: input.sqlHash ?? derivedSqlHash,
              digestText: input.digestText ?? digestSample?.digestText,
              reason: input.sql
                ? digestSample?.digestText
                  ? "SQL text was provided, matched to performance_schema digest summaries, and analyzed with EXPLAIN plus runtime evidence."
                  : "SQL text was provided and analyzed with EXPLAIN evidence."
                : externalSlowSqlSample?.sql
                  ? "A SQL sample was resolved from the TaurusDB slow-log source and analyzed with EXPLAIN evidence."
                  : digestSample?.querySampleText
                    ? "A statement sample was resolved from performance_schema digest summaries and analyzed with EXPLAIN evidence."
                    : "Only an SQL identifier was provided, so live EXPLAIN evidence could not be collected yet.",
            },
          ]
        : undefined;

    if (!effectiveSql) {
      return {
        tool: "diagnose_slow_query",
        status: "inconclusive",
        severity: "info",
        summary: withDatasourceSummary(
          "Slow-query diagnosis needs SQL text for EXPLAIN-backed analysis",
          ctx.datasource,
        ),
        diagnosisWindow: {
          from: input.timeRange?.from,
          to: input.timeRange?.to,
          relative: input.timeRange?.relative,
        },
        rootCauseCandidates: [
          {
            code: "slow_query_missing_sql_text",
            title: "SQL text is required for explain-backed diagnosis",
            confidence: "low",
            rationale:
              "The current implementation can analyze a slow query only when the SQL text is available for live EXPLAIN correlation.",
          },
        ],
        keyFindings: [
          input.sqlHash
            ? `SQL hash ${input.sqlHash} was provided without the original SQL text.`
            : "No SQL text was provided.",
          externalSlowSqlSample
            ? "An external TaurusDB slow-log source was queried, but no usable SQL sample was returned."
            : undefined,
          input.digestText
            ? "Digest text was provided, but no matching statement sample was available in the configured sources."
            : "No digest text was provided.",
        ].filter((value): value is string => typeof value === "string"),
        suspiciousEntities: suspiciousSql ? { sqls: suspiciousSql } : undefined,
        evidence: [
          {
            source: "sql_identifier",
            title: "SQL identifier only",
            summary:
              "The diagnosis request contained an SQL identifier, but no live EXPLAIN was run because the SQL text could not be resolved.",
          },
        ],
        recommendedActions: [
          "Provide the full SQL text so the tool can run explain-based diagnosis.",
          "If TaurusDB slow-log API is configured, verify its project, instance, node, and token settings.",
          "If you are using digest_text, verify that performance_schema statement digest summaries are enabled and retaining QUERY_SAMPLE_TEXT.",
        ],
        limitations: [
          engine.slowSqlSource
            ? "Identifier-only diagnosis currently depends on TaurusDB slow-log samples and performance_schema digest samples."
            : "No external slow-SQL source is connected yet.",
          engine.slowSqlSource
            ? "The TaurusDB slow-log source currently resolves SQL samples but does not yet provide full Top SQL or all-query history coverage."
            : "Identifier-only diagnosis is limited to performance_schema digest samples in the current version.",
        ],
      };
    }

    const explain = await engine.explainEnhanced(effectiveSql, ctx);
    const standardPlan = explain.standardPlan;
    const riskSummary = standardPlan.riskSummary;
    const resolvedPlanTables = await collectPlanTableStats(
      engine,
      ctx,
      standardPlan.plan,
    );
    const rootCauseCandidates = buildSlowQueryRootCauseCandidates({
      riskSummary,
      explain,
      digestSample,
      runtimeLockTimeMs,
      waitEventRows,
    });
    const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
    const sortedRootCauseCandidates =
      sortRootCauseCandidates(rootCauseCandidates);
    const severity = severityFromSlowQueryEvidence(
      riskSummary,
      sortedRootCauseCandidates,
    );

    const keyFindings = buildSlowQueryKeyFindings({
      riskSummary,
      resolvedPlanTables,
      digestSample,
      externalSlowSqlSample,
      runtimeRowsExamined,
      runtimeLockTimeMs,
      waitEventRows,
    });
    const recommendedActions = buildSlowQueryRecommendedActions({
      standardPlan,
      explain,
      riskSummary,
      resolvedPlanTables,
      digestSample,
      runtimeLockTimeMs,
      topWaitEvent: waitEventRows[0],
    });

    return {
      tool: "diagnose_slow_query",
      status: "ok",
      severity,
      summary: withDatasourceSummary(
        "Slow-query diagnosis collected live EXPLAIN evidence for the provided SQL",
        ctx.datasource,
      ),
      diagnosisWindow: {
        from: input.timeRange?.from,
        to: input.timeRange?.to,
        relative: input.timeRange?.relative,
      },
      rootCauseCandidates: sortedRootCauseCandidates.slice(0, maxCandidates),
      keyFindings,
      suspiciousEntities: suspiciousSql ? { sqls: suspiciousSql } : undefined,
      evidence: buildSlowQueryEvidence({
        standardPlan,
        riskSummary,
        resolvedPlanTables,
        digestSample,
        externalSlowSqlSample,
        waitEventRows,
      }),
      recommendedActions,
      limitations: [
        engine.slowSqlSource
          ? "Identifier-only diagnosis can use TaurusDB slow-log samples, but still depends on available retention and query_sample coverage."
          : "No external slow-SQL source is connected yet, so identifier-only diagnosis currently depends on performance_schema digest samples.",
        "Runtime wait-event correlation currently depends on performance_schema statement and wait history being enabled and retaining matching samples.",
      ],
    };
  }
