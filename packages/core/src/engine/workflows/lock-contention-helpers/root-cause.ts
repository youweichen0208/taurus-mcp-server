import type { DiagnosticRootCauseCandidate } from "../../../diagnostics/types.js";
import type { DeadlockSummary } from "../../helpers.js";
import type { LockContentionSignals } from "./signals.js";

export function buildLockContentionRootCauseCandidates(
  signals: LockContentionSignals,
  latestDeadlock?: DeadlockSummary,
): DiagnosticRootCauseCandidate[] {
  const candidates: DiagnosticRootCauseCandidate[] = [];
  const {
    idleTransactionBlockers,
    topBlocker,
    longWaits,
    tableLevelWaits,
    topTable,
    topMetadataBlocker,
    topMetadataTable,
  } = signals;

  if (idleTransactionBlockers.length > 0) {
    candidates.push({
      code: "lock_contention_idle_transaction_blocker",
      title: "Idle transaction blocker is holding locks",
      confidence: idleTransactionBlockers.length >= 2 ? "high" : "medium",
      rationale: `${idleTransactionBlockers.length} current waits are blocked by sessions with no active processlist state while their transaction is still active; an idle session can continue holding row locks until COMMIT or ROLLBACK.`,
    });
  }
  if (topBlocker && topBlocker.count >= 2) {
    candidates.push({
      code: "lock_contention_single_blocker_hotspot",
      title: "A single blocker session is holding up multiple waiters",
      confidence: topBlocker.count >= 3 ? "high" : "medium",
      rationale: `Blocking session ${topBlocker.key} appears in ${topBlocker.count} current lock waits.`,
    });
  }
  if (longWaits.length > 0) {
    candidates.push({
      code: "lock_contention_long_wait_chain",
      title: "Long lock waits indicate a stuck or slow blocker transaction",
      confidence: longWaits.length >= 2 ? "high" : "medium",
      rationale: `${longWaits.length} current lock waits have been blocked for at least 60 seconds.`,
    });
  }
  if (tableLevelWaits.length > 0) {
    candidates.push({
      code: "lock_contention_table_level_locking",
      title: "Table-level locking is amplifying the wait chain",
      confidence: tableLevelWaits.length >= 2 ? "medium" : "low",
      rationale:
        "At least one current wait involves a TABLE lock, which often points to broader blocking impact than a single row conflict.",
    });
  }
  if (topTable && topTable.count >= 2) {
    candidates.push({
      code: "lock_contention_hot_table",
      title: "Contention is concentrated on a single table",
      confidence: topTable.count >= 3 ? "high" : "medium",
      rationale: `${topTable.key} appears in ${topTable.count} current lock waits.`,
    });
  }
  if (topMetadataBlocker && topMetadataBlocker.count >= 1) {
    candidates.push({
      code: "lock_contention_metadata_lock_blocker",
      title: "Metadata lock waits point to a blocker session",
      confidence: topMetadataBlocker.count >= 2 ? "high" : "medium",
      rationale: `Blocking session ${topMetadataBlocker.key} appears in ${topMetadataBlocker.count} current metadata-lock waits.`,
    });
  }
  if (topMetadataTable) {
    candidates.push({
      code: "lock_contention_metadata_lock_hot_object",
      title: "Metadata lock contention is concentrated on one object",
      confidence: topMetadataTable.count >= 2 ? "medium" : "low",
      rationale: `${topMetadataTable.key} appears in ${topMetadataTable.count} current metadata-lock waits.`,
    });
  }
  if (latestDeadlock) {
    candidates.push({
      code: "lock_contention_recent_deadlock_detected",
      title: "A recent deadlock was detected by InnoDB",
      confidence: "medium",
      rationale: latestDeadlock.detectedAt
        ? `SHOW ENGINE INNODB STATUS reports a latest detected deadlock at ${latestDeadlock.detectedAt}.`
        : "SHOW ENGINE INNODB STATUS reports a recent deadlock in the latest deadlock section.",
    });
  }
  if (candidates.length === 0) {
    candidates.push({
      code: "lock_contention_snapshot_collected",
      title: "Lock waits are present but no dominant blocker pattern was isolated",
      confidence: "low",
      rationale:
        "A live lock-wait snapshot was collected, but the current wait chain does not show one dominant blocker, table, or long-wait pattern.",
    });
  }

  return candidates;
}
