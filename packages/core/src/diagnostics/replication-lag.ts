import type { SessionContext } from "../context/session-context.js";
import type { QueryResult, SqlExecutor } from "../executor/sql-executor.js";
import type {
  DiagnoseReplicationLagInput,
  DiagnosticResult,
} from "./types.js";

type ReplicationRow = Record<string, unknown>;

function rowsAsObjects(result: QueryResult): ReplicationRow[] {
  return result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column, index) => [column.name, row[index]]),
    ),
  );
}

function text(row: ReplicationRow, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return undefined;
}

function number(row: ReplicationRow, ...names: string[]): number | undefined {
  const value = text(row, ...names);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readReplicationStatus(
  executor: SqlExecutor,
  ctx: SessionContext,
): Promise<ReplicationRow[]> {
  try {
    return rowsAsObjects(
      await executor.executeReadonly("SHOW REPLICA STATUS", ctx, {
        maxRows: 20,
        maxColumns: 80,
        maxFieldChars: 512,
        maxResultBytes: 262144,
      }),
    );
  } catch {
    return rowsAsObjects(
      await executor.executeReadonly("SHOW SLAVE STATUS", ctx, {
        maxRows: 20,
        maxColumns: 80,
        maxFieldChars: 512,
        maxResultBytes: 262144,
      }),
    );
  }
}

export async function diagnoseReplicationLag(
  executor: SqlExecutor,
  input: DiagnoseReplicationLagInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
  let rows: ReplicationRow[];
  try {
    rows = await readReplicationStatus(executor, ctx);
  } catch {
    rows = [];
  }

  const filtered = rows.filter((row) => {
    const channel = text(row, "Channel_Name");
    const replicaId = text(row, "Server_Id", "Source_Server_Id", "Master_Server_Id");
    return (
      (!input.channel || channel === input.channel) &&
      (!input.replicaId || replicaId === input.replicaId)
    );
  });
  const window = {
    from: input.timeRange?.from,
    to: input.timeRange?.to,
    relative: input.timeRange?.relative,
  };
  if (filtered.length === 0) {
    return {
      tool: "diagnose_replication_lag",
      status: "not_applicable",
      severity: "info",
      summary: "No replication channel was visible on the selected database endpoint.",
      diagnosisWindow: window,
      rootCauseCandidates: [],
      keyFindings: [
        "SHOW REPLICA STATUS and SHOW SLAVE STATUS returned no matching channel.",
      ],
      evidence: [],
      recommendedActions: [
        "Confirm that the selected endpoint is a read replica and that the read-only SQL user can inspect replication status.",
      ],
      limitations: [
        "A primary or standalone endpoint legitimately has no replica status.",
        "Cloud time-series replication metrics are not included in this data-plane-only result.",
      ],
    };
  }

  const findings = filtered.map((row) => {
    const lag = number(row, "Seconds_Behind_Source", "Seconds_Behind_Master");
    const io = text(row, "Replica_IO_Running", "Slave_IO_Running") ?? "unknown";
    const sql = text(row, "Replica_SQL_Running", "Slave_SQL_Running") ?? "unknown";
    const channel = text(row, "Channel_Name") ?? "default";
    return { lag, io, sql, channel };
  });
  const maxLag = Math.max(...findings.map((item) => item.lag ?? 0));
  const stopped = findings.some(
    (item) => item.io.toLowerCase() === "no" || item.sql.toLowerCase() === "no",
  );
  const severity = stopped || maxLag >= 300 ? "high" : maxLag >= 30 ? "warning" : "info";
  const status = stopped || maxLag >= 30 ? "inconclusive" : "ok";

  return {
    tool: "diagnose_replication_lag",
    status,
    severity,
    summary: stopped
      ? "At least one replication worker is not running."
      : `Observed maximum replication delay of ${maxLag} seconds.`,
    diagnosisWindow: window,
    rootCauseCandidates: [
      ...(stopped
        ? [{
            code: "replication_worker_stopped",
            title: "Replication worker stopped",
            confidence: "high" as const,
            rationale: "Replica IO or SQL worker reports No.",
          }]
        : []),
      ...(maxLag >= 30
        ? [{
            code: "replication_delay",
            title: "Replica apply delay",
            confidence: "high" as const,
            rationale: `Seconds behind source reached ${maxLag}.`,
          }]
        : []),
    ],
    keyFindings: findings.map(
      (item) =>
        `Channel ${item.channel}: lag=${item.lag ?? "unknown"}s, io=${item.io}, sql=${item.sql}.`,
    ),
    evidence: [{
      source: "replication_status",
      title: "Current replication status",
      summary: `Collected ${findings.length} matching replication channel(s).`,
    }],
    recommendedActions: stopped
      ? [
          "Inspect Last_IO_Error and Last_SQL_Error directly with a privileged DBA account.",
          "Do not skip replication errors until the failed event and data consistency impact are understood.",
        ]
      : maxLag >= 30
        ? [
            "Check long transactions, write bursts, DDL, and replica resource saturation.",
            "Compare lag over time in Cloud Eye before changing replica topology.",
          ]
        : ["Continue monitoring the replication delay trend."],
    limitations: [
      "This result is a point-in-time data-plane snapshot.",
      "Error text and relay-log SQL are intentionally not returned to the MCP client.",
    ],
  };
}
