import type { SessionContext } from "../../context/session-context.js";
import type {
  DiagnoseLockContentionInput,
  DiagnosticResult,
} from "../../diagnostics/types.js";
import type { TaurusDBEngine } from "../../engine.js";
import { clampInteger, lockEvidenceRowLimit, parseLockWaitRows, withDatasourceSummary } from "../helpers.js";
import {
  buildLockContentionEvidence,
  buildLockContentionKeyFindings,
  buildLockContentionRecommendedActions,
  buildLockContentionRootCauseCandidates,
  buildLockContentionSignals,
  buildLockContentionSuspiciousEntities,
  buildNoMatchingLockContentionResult,
  severityFromLockContentionSignals,
} from "./lock-contention-helpers.js";

export async function diagnoseLockContention(
  engine: TaurusDBEngine,
  input: DiagnoseLockContentionInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
  const [lockWaits, metadataLockRows, latestDeadlock] = await Promise.all([
    engine.showLockWaits(
      {
        table: input.table,
        blockerSessionId: input.blockerSessionId,
        includeSql: false,
        maxRows: lockEvidenceRowLimit(input.evidenceLevel),
      },
      ctx,
    ),
    engine.findMetadataLockWaits(input, ctx),
    engine.findLatestDeadlock(ctx),
  ]);
  const rows = parseLockWaitRows(lockWaits);
  const signals = buildLockContentionSignals(rows, metadataLockRows);

  if (
    rows.length === 0 &&
    metadataLockRows.length === 0 &&
    latestDeadlock === undefined
  ) {
    return buildNoMatchingLockContentionResult(input, ctx);
  }

  const maxCandidates = clampInteger(input.maxCandidates, 3, 1, 10);
  const severity = severityFromLockContentionSignals(rows, signals);
  const rootCauseCandidates = buildLockContentionRootCauseCandidates(
    signals,
    latestDeadlock,
  );
  const suspiciousEntities = buildLockContentionSuspiciousEntities({
    rows,
    metadataLockRows,
    latestDeadlock,
    signals,
  });

  return {
    tool: "diagnose_lock_contention",
    status: "ok",
    severity,
    summary: withDatasourceSummary(
      `Lock-contention diagnosis collected a live InnoDB lock-wait snapshot with ${rows.length} matching waits`,
      ctx.datasource,
    ),
    diagnosisWindow: {
      from: input.timeRange?.from,
      to: input.timeRange?.to,
      relative: input.timeRange?.relative,
    },
    rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
    keyFindings: buildLockContentionKeyFindings({
      rows,
      metadataLockRows,
      latestDeadlock,
      diagnosisInput: input,
      signals,
    }),
    suspiciousEntities,
    evidence: buildLockContentionEvidence({
      rows,
      metadataLockRows,
      latestDeadlock,
      signals,
    }),
    recommendedActions: buildLockContentionRecommendedActions({
      latestDeadlock,
      metadataLockRows,
      signals,
    }),
    limitations: [
      "Live lock evidence remains point-in-time; waits that finish before collection will not appear.",
      latestDeadlock
        ? "Deadlock history currently uses the latest deadlock section only and does not yet parse a longer deadlock archive."
        : "Deadlock history was not available from SHOW ENGINE INNODB STATUS in this run.",
    ],
  };
}
