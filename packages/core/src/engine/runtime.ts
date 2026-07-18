import { UnsupportedFeatureError } from "../capability/types.js";
import type { FeatureMatrix } from "../capability/types.js";
import type { SessionContext } from "../context/session-context.js";
import type { CancelResult, ExplainResult, MutationOptions, MutationResult, QueryResult, QueryStatus, ReadonlyOptions } from "../executor/sql-executor.js";
import type { ConfirmationRequest, ConfirmationValidationResult } from "../safety/confirmation-store.js";
import { InMemoryConfirmationStore } from "../safety/confirmation-store.js";
import type { GuardrailDecision } from "../safety/guardrail.js";
import {
  buildFlashbackSql,
  FlashbackNoViewError,
  flashbackReadonlyOptions,
  formatTimestamp,
  normalizeFlashbackWhereClause,
  resolveRelativeTimestampFromBase,
  resolveFlashbackTimestamp,
  type FlashbackInput,
} from "../taurus/flashback.js";
import { buildListRecycleBinSql, buildRestoreRecycleBinTableSql, recycleBinMutationOptions, recycleBinReadonlyOptions, type RestoreRecycleBinTableInput } from "../taurus/recycle-bin.js";
import type { ConfirmationOutcome, EnhancedExplainResult, IssueConfirmationInput, TaurusDBEngine } from "../engine.js";
import { normalizeSql, sqlHash } from "../utils/hash.js";
import { quoteMysqlIdentifier } from "../utils/mysql-identifier.js";

function resolveConfirmationSql(input: IssueConfirmationInput): {
  normalized: string;
  hash: string;
} {
  const normalized =
    input.normalizedSql ?? (input.sql ? normalizeSql(input.sql) : undefined);
  const hash = input.sqlHash ?? (normalized ? sqlHash(normalized) : undefined);

  if (!normalized || !hash) {
    throw new Error(
      "Issue confirmation requires sql, normalizedSql, or sqlHash context.",
    );
  }

  return { normalized, hash };
}

function explainExtras(plan: ExplainResult["plan"]): string[] {
  return plan
    .map((row) => {
      if (!row || typeof row !== "object") {
        return undefined;
      }
      const extra = (row.Extra ?? row.extra) as unknown;
      return typeof extra === "string" ? extra : undefined;
    })
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
}

function hasSqlPattern(sql: string, pattern: RegExp): boolean {
  return pattern.test(sql);
}

const NO_FLASHBACK_VIEW_PATTERN = /No view available for provided TIMESTAMP/i;
function firstRowAsObject(result: QueryResult): Record<string, unknown> | undefined {
  if (result.rows.length === 0) {
    return undefined;
  }

  const row = result.rows[0];
  return Object.fromEntries(
    result.columns.map((column, index) => [column.name, row[index]]),
  );
}

function parseLocalTimestampToDate(value: string): Date | undefined {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return undefined;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function shiftTimestamp(timestamp: string, deltaMs: number): string | undefined {
  const date = parseLocalTimestampToDate(timestamp);
  if (!date) {
    return undefined;
  }
  return formatTimestamp(new Date(date.getTime() + deltaMs));
}

async function buildFlashbackNoViewError(
  engine: TaurusDBEngine,
  ctx: SessionContext,
  input: FlashbackInput,
  database: string,
  requestedTimestamp: string,
): Promise<FlashbackNoViewError> {
  const details: FlashbackNoViewError["details"] = {
    database,
    table: input.table,
    where: input.where,
    requested_timestamp: requestedTimestamp,
    guidance: [
      "Use the exact pre-update timestamp when validating flashback behavior.",
      "If only an approximate time is known, try a timestamp slightly before the row's current updated_at value.",
    ],
  };

  try {
    const envResult = await engine.executor.executeReadonly(
      "SELECT NOW(6) AS now_time, @@innodb_rds_backquery_window AS backquery_window",
      ctx,
      { maxRows: 1, maxColumns: 2, maxFieldChars: 128 },
    );
    const envRow = firstRowAsObject(envResult);
    const nowTime =
      typeof envRow?.now_time === "string" ? envRow.now_time : undefined;
    const backqueryWindowRaw = envRow?.backquery_window;
    const backqueryWindow =
      typeof backqueryWindowRaw === "number"
        ? backqueryWindowRaw
        : typeof backqueryWindowRaw === "string" &&
            backqueryWindowRaw.trim().length > 0
          ? Number(backqueryWindowRaw)
          : undefined;

    details.current_time = nowTime;
    if (Number.isFinite(backqueryWindow)) {
      details.backquery_window_seconds = Number(backqueryWindow);
    }
    if (nowTime && Number.isFinite(backqueryWindow)) {
      details.earliest_supported_timestamp_estimate = shiftTimestamp(
        nowTime,
        -Number(backqueryWindow) * 1000,
      );
    }
  } catch {
    // Best-effort diagnostics only.
  }

  if (input.where?.trim()) {
    try {
      const where = normalizeFlashbackWhereClause(input.where);
      const updatedAtResult = await engine.executor.executeReadonly(
        `SELECT ${quoteMysqlIdentifier("updated_at")} FROM ${quoteMysqlIdentifier(
          database,
          "database",
        )}.${quoteMysqlIdentifier(input.table, "table")} WHERE (${where}) LIMIT 1`,
        ctx,
        { maxRows: 1, maxColumns: 1, maxFieldChars: 128 },
      );
      const updatedAtRow = firstRowAsObject(updatedAtResult);
      if (typeof updatedAtRow?.updated_at === "string") {
        details.current_row_updated_at = updatedAtRow.updated_at;
      }
    } catch {
      // The target table may not have updated_at, or the query may not be useful here.
    }
  }

  const recommendations = new Set<string>();
  const requestedMinusOneSecond = shiftTimestamp(requestedTimestamp, -1000);
  if (requestedMinusOneSecond) {
    recommendations.add(requestedMinusOneSecond);
  }
  if (details.current_row_updated_at) {
    for (const deltaMs of [-1000, -5000, -30000, -60000]) {
      const candidate = shiftTimestamp(details.current_row_updated_at, deltaMs);
      if (candidate) {
        recommendations.add(candidate);
      }
    }
  }
  if (
    details.current_time &&
    typeof details.backquery_window_seconds === "number"
  ) {
    const withinWindowCandidate = shiftTimestamp(details.current_time, -60_000);
    if (withinWindowCandidate) {
      recommendations.add(withinWindowCandidate);
    }
  }
  if (recommendations.size > 0) {
    details.recommended_timestamps = [...recommendations].slice(0, 5);
  }

  return new FlashbackNoViewError(
    "No view available for provided TIMESTAMP.",
    details,
  );
}

async function resolveFlashbackInputForExecution(
  engine: TaurusDBEngine,
  ctx: SessionContext,
  input: FlashbackInput,
): Promise<FlashbackInput> {
  if (!("relative" in input.asOf) || typeof input.asOf.relative !== "string") {
    return input;
  }

  const envResult = await engine.executor.executeReadonly(
    "SELECT NOW(6) AS now_time",
    ctx,
    { maxRows: 1, maxColumns: 1, maxFieldChars: 128 },
  );
  const envRow = firstRowAsObject(envResult);
  if (typeof envRow?.now_time !== "string") {
    throw new Error(
      "Unable to resolve database current time for flashback relative timestamp.",
    );
  }

  return {
    ...input,
    asOf: {
      timestamp: resolveRelativeTimestampFromBase(
        input.asOf.relative,
        envRow.now_time,
      ),
    },
  };
}

function buildEnhancedExplainSuggestions(
  sql: string,
  features: FeatureMatrix,
  explainResult: ExplainResult,
): string[] {
  const suggestions: string[] = [...explainResult.recommendations];

  if (!features.parallel_query.available) {
    suggestions.push("parallel_query is unavailable on this instance.");
  } else if (features.parallel_query.enabled === false) {
    suggestions.push(
      "parallel_query is available but disabled. Consider SET GLOBAL force_parallel_execute=ON.",
    );
  }

  if (!features.flashback_query.available) {
    suggestions.push(
      "flashback_query is unavailable; high-risk mutations have weaker recovery options.",
    );
  }

  if (
    features.offset_pushdown.available &&
    features.offset_pushdown.enabled !== false
  ) {
    if (hasSqlPattern(sql, /\boffset\s+\d+/i)) {
      suggestions.push(
        "OFFSET detected. TaurusDB offset_pushdown may help reduce coordinator overhead.",
      );
    }
  }

  if (
    explainResult.riskSummary.fullTableScanLikely &&
    features.ndp_pushdown.available
  ) {
    suggestions.push(
      "Full table scan is likely. Review whether NDP pushdown can reduce scanned rows.",
    );
  }

  return [...new Set(suggestions)];
}

function buildOffsetPushdownExplanation(
  matched: boolean,
  hasOffset: boolean,
  features: FeatureMatrix,
): EnhancedExplainResult["featureExplanations"]["offsetPushdown"] {
  return {
    matched,
    meaning:
      "offset_pushdown is a TaurusDB pagination optimization for LIMIT/OFFSET queries that pushes row-skipping work closer to the storage layer.",
    whyTriggered: matched
      ? "This query uses ORDER BY with LIMIT/OFFSET, so TaurusDB can apply offset handling during indexed row retrieval instead of discarding as many rows at the coordinator layer."
      : !hasOffset
        ? "The SQL does not contain an OFFSET clause, so there is no offset workload to push down."
        : features.offset_pushdown.enabled === false
          ? "The SQL uses OFFSET, but the instance-level offset_pushdown optimization is disabled."
          : "The SQL uses OFFSET, but the plan did not confirm that TaurusDB could push the offset handling down for this shape.",
    expectedBenefit: matched
      ? "Reduces intermediate rows that must be materialized and discarded for deep pagination, which lowers coordinator overhead and makes large OFFSET pages more stable."
      : "No offset_pushdown benefit is expected for this execution path.",
  };
}

function buildParallelQueryExplanation(
  matched: boolean,
  features: FeatureMatrix,
  standardPlan: ExplainResult,
  sql: string,
): EnhancedExplainResult["featureExplanations"]["parallelQuery"] {
  const aggregationLike = hasSqlPattern(sql, /\b(group\s+by|order\s+by|join)\b/i);
  return {
    matched,
    meaning:
      "parallel_query lets TaurusDB split eligible scan or aggregation work across multiple workers to improve throughput on larger analytical reads.",
    whyTriggered: matched
      ? "This query shape looks like a larger scan or aggregation, and parallel_query is enabled on the instance, so TaurusDB may benefit from parallel execution."
      : !features.parallel_query.available
        ? features.parallel_query.reason ??
          "parallel_query is unavailable on this instance."
        : features.parallel_query.enabled === false
          ? "The query shape may benefit from parallel execution, but force_parallel_execute is currently disabled."
          : aggregationLike || standardPlan.riskSummary.fullTableScanLikely
            ? "The query shape is compatible with parallel_query, but the estimated work size was not large enough to justify turning it on."
            : "This query is too small or too index-selective to meaningfully benefit from parallel workers.",
    expectedBenefit: matched
      ? "Can improve throughput for larger scans, GROUP BY, ORDER BY, and join-heavy reads by spreading work across multiple workers."
      : "No meaningful parallel-query gain is expected for this execution path.",
  };
}

function buildNdpPushdownExplanation(
  matched: boolean,
  features: FeatureMatrix,
  extras: string,
): EnhancedExplainResult["featureExplanations"]["ndpPushdown"] {
  return {
    matched,
    meaning:
      "ndp_pushdown lets TaurusDB push filter, projection, or aggregation work down toward the data nodes so less data has to travel back to the coordinator.",
    whyTriggered: matched
      ? `The EXPLAIN Extra field shows TaurusDB NDP pushdown markers (${extras.trim() || "NDP pushdown detected"}), which indicates parts of the filter or aggregation are being executed closer to storage.`
      : !features.ndp_pushdown.available
        ? features.ndp_pushdown.reason ?? "ndp_pushdown is unavailable on this instance."
        : features.ndp_pushdown.enabled === false
          ? "The query shape could use NDP pushdown, but the feature is disabled on this instance."
          : "The EXPLAIN plan did not expose TaurusDB NDP pushdown markers for this SQL, so the result cannot confirm that NDP was used.",
    expectedBenefit: matched
      ? "Reduces coordinator CPU and network transfer by shrinking the amount of raw row data that must be returned from the storage side."
      : "No NDP pushdown benefit is expected for this execution path.",
  };
}

export async function explain(
  engine: TaurusDBEngine,
  sql: string, ctx: SessionContext): Promise<ExplainResult> {
    return engine.executor.explain(sql, ctx);
  }

export async function explainEnhanced(
  engine: TaurusDBEngine,
  sql: string,
  ctx: SessionContext,
): Promise<EnhancedExplainResult> {
    const [standardPlan, features] = await Promise.all([
      engine.executor.explain(sql, ctx),
      engine.capabilityProbe.listFeatures(ctx),
    ]);
    const extras = explainExtras(standardPlan.plan).join(" ");
    const fullScanLikely = standardPlan.riskSummary.fullTableScanLikely;
    const hasOffset = hasSqlPattern(sql, /\boffset\s+\d+/i);
    const ndpMatched =
      /using pushed ndp condition/i.test(extras) ||
      /using pushed ndp columns/i.test(extras) ||
      /using pushed ndp aggregate/i.test(extras);
    const parallelWouldEnable =
      features.parallel_query.available &&
      (fullScanLikely ||
        hasSqlPattern(sql, /\b(group\s+by|order\s+by|join)\b/i) ||
        (standardPlan.riskSummary.estimatedRows ?? 0) >= 100_000);
    const offsetMatched =
      hasOffset &&
      features.offset_pushdown.available &&
      features.offset_pushdown.enabled !== false;

    return {
      standardPlan,
      taurusHints: {
        ndpPushdown: {
          condition: /using pushed ndp condition/i.test(extras),
          columns: /using pushed ndp columns/i.test(extras),
          aggregate: /using pushed ndp aggregate/i.test(extras),
          blockedReason: !features.ndp_pushdown.available
            ? features.ndp_pushdown.reason
            : features.ndp_pushdown.enabled === false
              ? "ndp_pushdown is available but not enabled."
              : undefined,
        },
        parallelQuery: {
          wouldEnable: parallelWouldEnable,
          estimatedDegree:
            features.parallel_query.available && features.parallel_query.enabled
              ? ctx.limits.maxRows >= 1000
                ? 4
                : 2
              : undefined,
          blockedReason: !features.parallel_query.available
            ? features.parallel_query.reason
            : features.parallel_query.enabled === false
              ? "parallel_query is available but force_parallel_execute is disabled."
              : undefined,
        },
        offsetPushdown: offsetMatched,
      },
      featureExplanations: {
        offsetPushdown: buildOffsetPushdownExplanation(
          offsetMatched,
          hasOffset,
          features,
        ),
        parallelQuery: buildParallelQueryExplanation(
          parallelWouldEnable,
          features,
          standardPlan,
          sql,
        ),
        ndpPushdown: buildNdpPushdownExplanation(
          ndpMatched,
          features,
          extras,
        ),
      },
      optimizationSuggestions: buildEnhancedExplainSuggestions(
        sql,
        features,
        standardPlan,
      ),
    };
  }

export async function executeReadonly(
  engine: TaurusDBEngine,
  sql: string,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    return engine.executor.executeReadonly(sql, ctx, opts);
  }

export async function executeMutation(
  engine: TaurusDBEngine,
  sql: string,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult> {
    return engine.executor.executeMutation(sql, ctx, opts);
  }

export async function flashbackQuery(
  engine: TaurusDBEngine,
  input: FlashbackInput,
    ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    const features = await engine.capabilityProbe.listFeatures(ctx);
    const flashbackFeature = features.flashback_query;
    if (!flashbackFeature.available || flashbackFeature.enabled === false) {
      throw new UnsupportedFeatureError(
        "flashback_query",
        flashbackFeature.reason ??
          `Flashback query requires kernel version >= ${flashbackFeature.minVersion ?? "unknown"}.`,
        {
          requiredVersion: flashbackFeature.minVersion,
          parameterHint: flashbackFeature.param,
          currentVersion: (await engine.capabilityProbe.getKernelInfo(ctx))
            .kernelVersion,
        },
      );
    }

    const database = input.database ?? ctx.database;
    if (!database) {
      throw new Error(
        "Flashback query requires a database context. Provide input.database or configure a default database.",
      );
    }

    const effectiveInput = await resolveFlashbackInputForExecution(
      engine,
      ctx,
      input,
    );
    const sql = buildFlashbackSql(effectiveInput, database);
    try {
      return await engine.executor.executeReadonly(sql, ctx, {
        ...flashbackReadonlyOptions(input.limit),
        ...opts,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        NO_FLASHBACK_VIEW_PATTERN.test(error.message)
      ) {
        const requestedTimestamp = resolveFlashbackTimestamp(
          effectiveInput.asOf,
        );
        throw await buildFlashbackNoViewError(
          engine,
          ctx,
          effectiveInput,
          database,
          requestedTimestamp,
        );
      }
      throw error;
    }
  }

export async function listRecycleBin(
  engine: TaurusDBEngine,
  ctx: SessionContext,
    opts?: ReadonlyOptions,
  ): Promise<QueryResult> {
    const features = await engine.capabilityProbe.listFeatures(ctx);
    const recycleBinFeature = features.recycle_bin;
    if (!recycleBinFeature.available || recycleBinFeature.enabled === false) {
      throw new UnsupportedFeatureError(
        "recycle_bin",
        recycleBinFeature.reason ??
          `Recycle bin requires kernel version >= ${recycleBinFeature.minVersion ?? "unknown"}.`,
        {
          requiredVersion: recycleBinFeature.minVersion,
          parameterHint: recycleBinFeature.param,
          currentVersion: (await engine.capabilityProbe.getKernelInfo(ctx))
            .kernelVersion,
        },
      );
    }

    return engine.executor.executeReadonly(buildListRecycleBinSql(), ctx, recycleBinReadonlyOptions(opts));
  }

export async function restoreRecycleBinTable(
  engine: TaurusDBEngine,
  input: RestoreRecycleBinTableInput,
    ctx: SessionContext,
    opts?: MutationOptions,
  ): Promise<MutationResult> {
    const features = await engine.capabilityProbe.listFeatures(ctx);
    const recycleBinFeature = features.recycle_bin;
    if (!recycleBinFeature.available || recycleBinFeature.enabled === false) {
      throw new UnsupportedFeatureError(
        "recycle_bin",
        recycleBinFeature.reason ??
          `Recycle bin requires kernel version >= ${recycleBinFeature.minVersion ?? "unknown"}.`,
        {
          requiredVersion: recycleBinFeature.minVersion,
          parameterHint: recycleBinFeature.param,
          currentVersion: (await engine.capabilityProbe.getKernelInfo(ctx))
            .kernelVersion,
        },
      );
    }

    return engine.executor.executeMutation(
      buildRestoreRecycleBinTableSql(input),
      ctx,
      {
        ...recycleBinMutationOptions(opts),
      },
    );
  }

export async function getQueryStatus(
  engine: TaurusDBEngine,
  queryId: string): Promise<QueryStatus> {
    return engine.executor.getQueryStatus(queryId);
  }

export async function cancelQuery(
  engine: TaurusDBEngine,
  queryId: string): Promise<CancelResult> {
    return engine.executor.cancelQuery(queryId);
  }

export async function issueConfirmation(
  engine: TaurusDBEngine,
  input: IssueConfirmationInput,
  ): Promise<ConfirmationRequest> {
    const resolved = resolveConfirmationSql(input);
    return engine.confirmationStore.issue({
      sqlHash: resolved.hash,
      normalizedSql: resolved.normalized,
      context: input.context,
      riskLevel: input.riskLevel,
      ttlSeconds: input.ttlSeconds,
    });
  }

export async function validateConfirmation(
  engine: TaurusDBEngine,
  token: string,
  sql: string,
  ctx: SessionContext,
): Promise<ConfirmationValidationResult> {
    return engine.confirmationStore.validate(token, sql, ctx);
  }

export async function handleConfirmation(
  engine: TaurusDBEngine,
  decision: GuardrailDecision,
  ctx: SessionContext,
): Promise<ConfirmationOutcome> {
    if (!decision.requiresConfirmation) {
      return { status: "confirmed" };
    }

    const approval = await engine.confirmationStore.issue({
      sqlHash: decision.sqlHash,
      normalizedSql: decision.normalizedSql,
      context: ctx,
      riskLevel: decision.riskLevel,
    });

    return {
      status: "approval_required",
      request: approval.request,
      requestId: approval.requestId,
      issuedAt: approval.issuedAt,
      expiresAt: approval.expiresAt,
    };
  }

export async function close(
  engine: TaurusDBEngine, ): Promise<void> {
    await engine.connectionPool.close();
    if (engine.confirmationStore instanceof InMemoryConfirmationStore) {
      engine.confirmationStore.stop();
    }
  }
