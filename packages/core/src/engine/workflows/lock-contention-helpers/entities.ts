import type {
  DiagnosticResult,
  DiagnosticSuspiciousSession,
  DiagnosticSuspiciousTable,
} from "../../../diagnostics/types.js";
import {
  isIdleTransactionBlocker,
  type DeadlockSummary,
  type LockWaitRow,
  type MetadataLockRow,
} from "../../helpers.js";
import type { LockContentionSignals } from "./signals.js";

export function buildLockContentionSuspiciousEntities(input: {
  rows: LockWaitRow[];
  metadataLockRows: MetadataLockRow[];
  latestDeadlock?: DeadlockSummary;
  signals: LockContentionSignals;
}): DiagnosticResult["suspiciousEntities"] {
  const { rows, metadataLockRows, latestDeadlock, signals } = input;
  const { tableCounts, metadataTables, topBlocker } = signals;
  const blockerDetails = rows
    .filter(
      (row, index, allRows) =>
        row.blockingSessionId !== undefined &&
        allRows.findIndex(
          (candidate) => candidate.blockingSessionId === row.blockingSessionId,
        ) === index,
    )
    .slice(0, 3);
  const suspiciousSessions: DiagnosticSuspiciousSession[] = blockerDetails.map(
    (row) => ({
      sessionId: row.blockingSessionId,
      user: row.blockingUser,
      state: row.blockingState ?? row.blockingTrxState,
      reason: isIdleTransactionBlocker(row)
        ? `Observed as a blocker with no active processlist state; the transaction is still ${row.blockingTrxState}${row.blockingTrxAgeSeconds !== undefined ? ` and has been open for ${row.blockingTrxAgeSeconds}s` : ""}, so it can keep row locks until COMMIT or ROLLBACK.`
        : topBlocker && row.blockingSessionId === topBlocker.key
          ? `Top blocker in the current snapshot with ${topBlocker.count} waiting sessions.`
          : `Observed as a blocker in the current lock-wait snapshot${row.blockingTrxAgeSeconds !== undefined ? `; transaction age ${row.blockingTrxAgeSeconds}s` : ""}.`,
    }),
  );
  const suspiciousTables: DiagnosticSuspiciousTable[] = tableCounts
    .slice(0, 3)
    .map((entry) => ({
      table: entry.key,
      reason: `Observed in ${entry.count} current lock waits.`,
    }));

  for (const row of metadataLockRows.slice(0, 2)) {
    if (
      row.blockingSessionId &&
      !suspiciousSessions.some(
        (item) => item.sessionId === row.blockingSessionId,
      )
    ) {
      suspiciousSessions.push({
        sessionId: row.blockingSessionId,
        user: row.blockingUser,
        state: row.blockingState,
        reason: `Observed as a metadata-lock blocker${row.objectSchema || row.objectName ? ` on ${(row.objectSchema ? `${row.objectSchema}.` : "") + (row.objectName ?? "unknown")}` : ""}.`,
      });
    }
  }
  for (const entry of metadataTables.slice(0, 2)) {
    if (!suspiciousTables.some((item) => item.table === entry.key)) {
      suspiciousTables.push({
        table: entry.key,
        reason: `Observed in ${entry.count} current metadata-lock waits.`,
      });
    }
  }
  for (const table of latestDeadlock?.waitingTables.slice(0, 2) ?? []) {
    if (!suspiciousTables.some((item) => item.table === table)) {
      suspiciousTables.push({
        table,
        reason:
          "Referenced in the latest deadlock section from SHOW ENGINE INNODB STATUS.",
      });
    }
  }

  return suspiciousSessions.length > 0 || suspiciousTables.length > 0
    ? {
        sessions: suspiciousSessions.length > 0 ? suspiciousSessions : undefined,
        tables: suspiciousTables.length > 0 ? suspiciousTables : undefined,
      }
    : undefined;
}
