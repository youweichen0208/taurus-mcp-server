import type {
  DiagnoseLockContentionInput,
  DiagnosticEvidenceItem,
} from "../../../diagnostics/types.js";
import {
  isIdleTransactionBlocker,
  type DeadlockSummary,
  type LockWaitRow,
  type MetadataLockRow,
} from "../../helpers.js";
import type { LockContentionSignals } from "./signals.js";

export function buildLockContentionKeyFindings(input: {
  rows: LockWaitRow[];
  metadataLockRows: MetadataLockRow[];
  latestDeadlock?: DeadlockSummary;
  diagnosisInput: DiagnoseLockContentionInput;
  signals: LockContentionSignals;
}): string[] {
  const { rows, metadataLockRows, latestDeadlock, diagnosisInput, signals } =
    input;
  const {
    blockerCounts,
    topBlocker,
    idleTransactionBlockers,
    topTable,
    longWaits,
  } = signals;
  const keyFindings = [
    rows.length > 0
      ? `Collected ${rows.length} current InnoDB lock waits across ${blockerCounts.length} blocker sessions.`
      : "No current InnoDB row-lock waits were captured.",
  ];

  if (topBlocker) {
    keyFindings.push(
      `Blocking session ${topBlocker.key} accounts for ${topBlocker.count} waits in the current snapshot.`,
    );
  }
  if (idleTransactionBlockers.length > 0) {
    keyFindings.push(
      `${idleTransactionBlockers.length} waits are blocked by idle sessions with active transactions; an idle processlist state does not imply locks are released when the transaction remains uncommitted.`,
    );
  }
  if (topTable) {
    keyFindings.push(
      `Most waits are concentrated on ${topTable.key} (${topTable.count} waits).`,
    );
  }
  if (longWaits.length > 0) {
    keyFindings.push(
      `${longWaits.length} waits have been blocked for at least 60 seconds.`,
    );
  }
  if (diagnosisInput.blockerSessionId) {
    keyFindings.push(
      `Diagnosis was filtered to blocker session ${diagnosisInput.blockerSessionId}.`,
    );
  }
  if (metadataLockRows.length > 0) {
    keyFindings.push(
      `Collected ${metadataLockRows.length} current metadata-lock waits.`,
    );
  }
  if (latestDeadlock) {
    keyFindings.push(
      latestDeadlock.detectedAt
        ? `Latest detected deadlock timestamp: ${latestDeadlock.detectedAt}.`
        : "SHOW ENGINE INNODB STATUS returned a latest detected deadlock section.",
    );
  }

  return keyFindings;
}

export function buildLockContentionRecommendedActions(input: {
  latestDeadlock?: DeadlockSummary;
  metadataLockRows: MetadataLockRow[];
  signals: LockContentionSignals;
}): string[] {
  const { latestDeadlock, metadataLockRows, signals } = input;
  const { idleTransactionBlockers, topTable, tableLevelWaits } = signals;
  const recommendedActions = [
    "Inspect the blocker session in show_processlist with include_info=true before terminating it.",
    "Review transaction scope and commit timing in the blocking application path to reduce lock hold time.",
  ];

  if (idleTransactionBlockers.length > 0) {
    recommendedActions.push(
      "For idle blocker sessions (Sleep or no active processlist state), verify whether the application left a transaction uncommitted; prefer COMMIT or ROLLBACK from the owning client before considering KILL.",
    );
  }
  if (topTable) {
    recommendedActions.push(
      `Review the access pattern and indexing on ${topTable.key} to reduce hot-row or hot-table conflicts.`,
    );
  }
  if (tableLevelWaits.length > 0) {
    recommendedActions.push(
      "Check for DDL or explicit table-lock operations because TABLE-level waits are present in the snapshot.",
    );
  }
  if (metadataLockRows.length > 0) {
    recommendedActions.push(
      "Review DDL, online schema change tooling, and long-running transactions because metadata-lock waits are present.",
    );
  }
  if (latestDeadlock) {
    recommendedActions.push(
      "Inspect the latest deadlock section in SHOW ENGINE INNODB STATUS and correlate the involved statements before changing only timeout or retry settings.",
    );
  }

  return [...new Set(recommendedActions)];
}

export function buildLockContentionEvidence(input: {
  rows: LockWaitRow[];
  metadataLockRows: MetadataLockRow[];
  latestDeadlock?: DeadlockSummary;
  signals: LockContentionSignals;
}): DiagnosticEvidenceItem[] {
  const { rows, metadataLockRows, latestDeadlock, signals } = input;
  const {
    blockerCounts,
    tableCounts,
    topBlocker,
    topTable,
    topMetadataTable,
    topMetadataBlocker,
  } = signals;
  const evidence: DiagnosticEvidenceItem[] = [
    {
      source: "lock_waits",
      title: "Current InnoDB lock-wait snapshot",
      summary:
        rows.length > 0
          ? `${rows.length} waits observed across ${blockerCounts.length} blocker sessions and ${tableCounts.length} locked tables.`
          : "No InnoDB row-lock waits were visible in the current snapshot.",
    },
  ];

  if (topBlocker) {
    const idleBlocker = rows.find(
      (row) =>
        row.blockingSessionId === topBlocker.key &&
        isIdleTransactionBlocker(row),
    );
    evidence.push({
      source: "lock_waits",
      title: "Dominant blocker session",
      summary: idleBlocker
        ? `Session ${topBlocker.key} is blocking ${topBlocker.count} current waits while it has no active processlist state; its transaction is still ${idleBlocker.blockingTrxState}, so an uncommitted transaction can continue holding locks.`
        : `Session ${topBlocker.key} is blocking ${topBlocker.count} current waits.`,
    });
  }
  if (topTable) {
    evidence.push({
      source: "lock_waits",
      title: "Hot locked table",
      summary: `${topTable.key} appears in ${topTable.count} current waits.`,
    });
  }
  if (metadataLockRows.length > 0) {
    evidence.push({
      source: "metadata_locks",
      title: "Current metadata-lock snapshot",
      summary: `Collected ${metadataLockRows.length} pending metadata locks${topMetadataTable ? `; hottest object=${topMetadataTable.key}` : ""}${topMetadataBlocker ? `, dominant blocker=${topMetadataBlocker.key}` : ""}.`,
    });
  }
  if (latestDeadlock) {
    evidence.push({
      source: "deadlock_history",
      title: "Latest detected deadlock",
      summary: latestDeadlock.summary,
    });
  }

  return evidence;
}
