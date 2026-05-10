import type { DiagnosticSeverity } from "../../../diagnostics/types.js";
import {
  countBy,
  isIdleTransactionBlocker,
  type LockWaitRow,
  type MetadataLockRow,
} from "../../helpers.js";

type CountEntry = { key: string; count: number };

export type LockContentionSignals = {
  blockerCounts: CountEntry[];
  tableCounts: CountEntry[];
  metadataTables: CountEntry[];
  metadataBlockers: CountEntry[];
  longWaits: LockWaitRow[];
  tableLevelWaits: LockWaitRow[];
  idleTransactionBlockers: LockWaitRow[];
  topBlocker?: CountEntry;
  topTable?: CountEntry;
  topMetadataTable?: CountEntry;
  topMetadataBlocker?: CountEntry;
};

export function buildLockContentionSignals(
  rows: LockWaitRow[],
  metadataLockRows: MetadataLockRow[],
): LockContentionSignals {
  const blockerCounts = countBy(rows, (row) => row.blockingSessionId);
  const tableCounts = countBy(rows, (row) =>
    row.lockedSchema && row.lockedTable
      ? `${row.lockedSchema}.${row.lockedTable}`
      : row.lockedTable,
  );
  const metadataTables = countBy(metadataLockRows, (row) =>
    row.objectSchema && row.objectName
      ? `${row.objectSchema}.${row.objectName}`
      : row.objectName,
  );
  const metadataBlockers = countBy(
    metadataLockRows,
    (row) => row.blockingSessionId,
  );

  const longWaits = rows.filter((row) => (row.waitAgeSeconds ?? 0) >= 60);
  const tableLevelWaits = rows.filter(
    (row) =>
      row.waitingLockType === "TABLE" || row.blockingLockType === "TABLE",
  );
  const idleTransactionBlockers = rows.filter(isIdleTransactionBlocker);

  return {
    blockerCounts,
    tableCounts,
    metadataTables,
    metadataBlockers,
    longWaits,
    tableLevelWaits,
    idleTransactionBlockers,
    topBlocker: blockerCounts[0],
    topTable: tableCounts[0],
    topMetadataTable: metadataTables[0],
    topMetadataBlocker: metadataBlockers[0],
  };
}

export function severityFromLockContentionSignals(
  rows: LockWaitRow[],
  signals: Pick<LockContentionSignals, "longWaits">,
): DiagnosticSeverity {
  return rows.length >= 10 || signals.longWaits.length >= 3
    ? "high"
    : rows.length >= 3 || signals.longWaits.length >= 1
      ? "warning"
      : "info";
}
