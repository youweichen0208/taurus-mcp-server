import { UnsupportedFeatureError } from "../capability/types.js";
import type { FeatureMatrix } from "../capability/types.js";
import type { SessionContext } from "../context/session-context.js";
import type { CancelResult, ExplainResult, MutationOptions, MutationResult, QueryResult, QueryStatus, ReadonlyOptions } from "../executor/sql-executor.js";
import type { ConfirmationToken, ConfirmationValidationResult } from "../safety/confirmation-store.js";
import { InMemoryConfirmationStore } from "../safety/confirmation-store.js";
import type { GuardrailDecision } from "../safety/guardrail.js";
import { buildFlashbackSql, flashbackReadonlyOptions, type FlashbackInput } from "../taurus/flashback.js";
import { buildListRecycleBinSql, buildRestoreRecycleBinTableSql, recycleBinMutationOptions, recycleBinReadonlyOptions, type RestoreRecycleBinTableInput } from "../taurus/recycle-bin.js";
import type { ConfirmationOutcome, EnhancedExplainResult, IssueConfirmationInput, TaurusDBEngine } from "../engine.js";
import { normalizeSql, sqlHash } from "../utils/hash.js";

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
          wouldEnable:
            features.parallel_query.available &&
            (fullScanLikely ||
              hasSqlPattern(sql, /\b(group\s+by|order\s+by|join)\b/i) ||
              (standardPlan.riskSummary.estimatedRows ?? 0) >= 100_000),
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
        offsetPushdown:
          hasOffset &&
          features.offset_pushdown.available &&
          features.offset_pushdown.enabled !== false,
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

    const sql = buildFlashbackSql(input, database);
    return engine.executor.executeReadonly(sql, ctx, {
      ...flashbackReadonlyOptions(input.limit),
      ...opts,
    });
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
          currentVersion: (await engine.capabilityProbe.getKernelInfo(ctx))
            .kernelVersion,
        },
      );
    }

    return engine.executor.executeMutation(
      buildRestoreRecycleBinTableSql(input),
      ctx,
      recycleBinMutationOptions(opts),
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
  ): Promise<ConfirmationToken> {
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

    const token = await engine.confirmationStore.issue({
      sqlHash: decision.sqlHash,
      normalizedSql: decision.normalizedSql,
      context: ctx,
      riskLevel: decision.riskLevel,
    });

    return {
      status: "token_issued",
      token: token.token,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    };
  }

export async function close(
  engine: TaurusDBEngine, ): Promise<void> {
    await engine.connectionPool.close();
    if (engine.confirmationStore instanceof InMemoryConfirmationStore) {
      engine.confirmationStore.stop();
    }
  }
