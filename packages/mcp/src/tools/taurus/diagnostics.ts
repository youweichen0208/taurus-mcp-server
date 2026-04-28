import { z } from "zod";
import {
  formatSuccess,
  type ToolResponse,
} from "../../utils/formatter.js";
import type {
  DiagnoseConnectionSpikeInput,
  DiagnoseDbHotspotInput,
  DiagnoseLockContentionInput,
  DiagnoseReplicationLagInput,
  DiagnoseServiceLatencyInput,
  DiagnoseSlowQueryInput,
  DiagnoseStoragePressureInput,
  FindTopSlowSqlInput,
} from "@huaweicloud/taurusdb-core";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asOptionalBoolean,
  asOptionalPositiveInteger,
  asOptionalString,
  diagnosticBaseInputShape,
  metadata,
  toPublicDbHotspotResult,
  resolveContext,
  toPublicDiagnosticResult,
  toPublicServiceLatencyResult,
  toPublicTopSlowSqlResult,
} from "../common.js";

function parseBaseInput(input: Record<string, unknown>) {
  return {
    datasource: asOptionalString(input.datasource, "datasource"),
    database: asOptionalString(input.database, "database"),
    timeRange: parseTimeRange(input.time_range),
    evidenceLevel: parseEvidenceLevel(input.evidence_level),
    includeRawEvidence: asOptionalBoolean(input.include_raw_evidence, "include_raw_evidence"),
    maxCandidates: asOptionalPositiveInteger(input.max_candidates, "max_candidates"),
  };
}

function parseTimeRange(value: unknown): DiagnoseSlowQueryInput["timeRange"] {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError("Invalid time_range: expected an object.");
  }

  const raw = value as Record<string, unknown>;
  return {
    from: asOptionalString(raw.from, "time_range.from"),
    to: asOptionalString(raw.to, "time_range.to"),
    relative: asOptionalString(raw.relative, "time_range.relative"),
  };
}

function parseEvidenceLevel(value: unknown): DiagnoseSlowQueryInput["evidenceLevel"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "basic" || value === "standard" || value === "full") {
    return value;
  }
  throw new ToolInputError("Invalid evidence_level: expected basic, standard, or full.");
}

function parseStorageScope(value: unknown): DiagnoseStoragePressureInput["scope"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "instance" || value === "database" || value === "table") {
    return value;
  }
  throw new ToolInputError("Invalid scope: expected instance, database, or table.");
}

function parseDbHotspotScope(
  value: unknown,
): DiagnoseDbHotspotInput["scope"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "sql" || value === "table" || value === "session") {
    return value;
  }
  throw new ToolInputError("Invalid scope: expected sql, table, or session.");
}

function parseLatencySymptom(
  value: unknown,
): DiagnoseServiceLatencyInput["symptom"] {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "latency"
    || value === "timeout"
    || value === "cpu"
    || value === "connection_growth"
  ) {
    return value;
  }
  throw new ToolInputError(
    "Invalid symptom: expected latency, timeout, cpu, or connection_growth.",
  );
}

function parseTopSlowSqlSortBy(value: unknown): FindTopSlowSqlInput["sortBy"] {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "avg_latency"
    || value === "total_latency"
    || value === "exec_count"
    || value === "lock_time"
  ) {
    return value;
  }
  throw new ToolInputError(
    "Invalid sort_by: expected avg_latency, total_latency, exec_count, or lock_time.",
  );
}

function summarizeDiagnostic(toolLabel: string, status: string): string {
  return `${toolLabel} returned ${status}.`;
}

export const findTopSlowSqlTool: ToolDefinition = {
  name: "find_top_slow_sql",
  description:
    "Find the most suspicious slow SQL statements for the selected datasource, database, and time window.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    top_n: z.number().int().positive().max(20).optional().describe("Maximum number of suspect SQL statements to return."),
    sort_by: z
      .enum(["avg_latency", "total_latency", "exec_count", "lock_time"])
      .optional()
      .describe("Ranking strategy for slow SQL discovery."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.findTopSlowSql(
        {
          ...parseBaseInput(input),
          topN: asOptionalPositiveInteger(input.top_n, "top_n"),
          sortBy: parseTopSlowSqlSortBy(input.sort_by),
        },
        ctx,
      );
      return formatSuccess(toPublicTopSlowSqlResult(result), {
        summary: summarizeDiagnostic("Top slow SQL discovery", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "find_top_slow_sql",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseServiceLatencyTool: ToolDefinition = {
  name: "diagnose_service_latency",
  description:
    "Route a business-latency symptom to the most likely SQL, lock, or connection suspects and suggest the next diagnostic tool.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    user: diagnosticString("Optional user to focus on."),
    client_host: diagnosticString("Optional client host or IP to focus on."),
    symptom: z
      .enum(["latency", "timeout", "cpu", "connection_growth"])
      .optional()
      .describe("Primary service symptom to route: latency, timeout, cpu, or connection_growth."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.diagnoseServiceLatency(
        {
          ...parseBaseInput(input),
          user: asOptionalString(input.user, "user"),
          clientHost: asOptionalString(input.client_host, "client_host"),
          symptom: parseLatencySymptom(input.symptom),
        },
        ctx,
      );
      return formatSuccess(toPublicServiceLatencyResult(result), {
        summary: summarizeDiagnostic("Service-latency diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_service_latency",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseDbHotspotTool: ToolDefinition = {
  name: "diagnose_db_hotspot",
  description:
    "Identify the hottest SQL, table, or session currently dragging down the datasource and recommend the next diagnostic tool.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    scope: z
      .enum(["sql", "table", "session"])
      .optional()
      .describe("Optional hotspot scope: sql, table, or session."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.diagnoseDbHotspot(
        {
          ...parseBaseInput(input),
          scope: parseDbHotspotScope(input.scope),
        },
        ctx,
      );
      return formatSuccess(toPublicDbHotspotResult(result), {
        summary: summarizeDiagnostic("Database-hotspot diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_db_hotspot",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseSlowQueryTool: ToolDefinition = {
  name: "diagnose_slow_query",
  description:
    "Diagnose why a SQL statement is slow using live EXPLAIN evidence and, when digest history is available, performance_schema runtime wait evidence.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    sql: diagnosticString("SQL text to diagnose."),
    sql_hash: diagnosticString("Normalized SQL hash to diagnose."),
    digest_text: diagnosticString("SQL digest text to diagnose."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const diagnosticInput: DiagnoseSlowQueryInput = {
        ...parseBaseInput(input),
        sql: asOptionalString(input.sql, "sql"),
        sqlHash: asOptionalString(input.sql_hash, "sql_hash"),
        digestText: asOptionalString(input.digest_text, "digest_text"),
      };
      if (!diagnosticInput.sql && !diagnosticInput.sqlHash && !diagnosticInput.digestText) {
        throw new ToolInputError("diagnose_slow_query requires sql, sql_hash, or digest_text.");
      }
      const result = await deps.engine.diagnoseSlowQuery(diagnosticInput, ctx);
      return formatSuccess(toPublicDiagnosticResult(result), {
        summary: summarizeDiagnostic("Slow-query diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_slow_query",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseConnectionSpikeTool: ToolDefinition = {
  name: "diagnose_connection_spike",
  description:
    "Diagnose connection spikes using live processlist evidence plus structured heuristic analysis.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    user: diagnosticString("Optional user to focus on."),
    client_host: diagnosticString("Optional client host or IP to focus on."),
    compare_baseline: diagnosticBoolean("Whether to compare the selected window with a baseline."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const diagnosticInput: DiagnoseConnectionSpikeInput = {
        ...parseBaseInput(input),
        user: asOptionalString(input.user, "user"),
        clientHost: asOptionalString(input.client_host, "client_host"),
        compareBaseline: asOptionalBoolean(input.compare_baseline, "compare_baseline"),
      };
      const result = await deps.engine.diagnoseConnectionSpike(diagnosticInput, ctx);
      return formatSuccess(toPublicDiagnosticResult(result), {
        summary: summarizeDiagnostic("Connection-spike diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_connection_spike",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseLockContentionTool: ToolDefinition = {
  name: "diagnose_lock_contention",
  description:
    "Diagnose InnoDB lock contention using live lock-wait evidence plus structured heuristic analysis.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    table: diagnosticString("Optional table to focus on."),
    blocker_session_id: diagnosticString("Optional blocker session identifier to focus on."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const diagnosticInput: DiagnoseLockContentionInput = {
        ...parseBaseInput(input),
        table: asOptionalString(input.table, "table"),
        blockerSessionId: asOptionalString(input.blocker_session_id, "blocker_session_id"),
      };
      const result = await deps.engine.diagnoseLockContention(diagnosticInput, ctx);
      return formatSuccess(toPublicDiagnosticResult(result), {
        summary: summarizeDiagnostic("Lock-contention diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_lock_contention",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseReplicationLagTool: ToolDefinition = {
  name: "diagnose_replication_lag",
  description:
    "Diagnose replication lag and replica replay pressure using replica status plus CES lag, long-transaction, and write-pressure signals.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    replica_id: diagnosticString("Optional replica identifier to focus on."),
    channel: diagnosticString("Optional replication channel to focus on."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const diagnosticInput: DiagnoseReplicationLagInput = {
        ...parseBaseInput(input),
        replicaId: asOptionalString(input.replica_id, "replica_id"),
        channel: asOptionalString(input.channel, "channel"),
      };
      const result = await deps.engine.diagnoseReplicationLag(diagnosticInput, ctx);
      return formatSuccess(toPublicDiagnosticResult(result), {
        summary: summarizeDiagnostic("Replication-lag diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_replication_lag",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnoseStoragePressureTool: ToolDefinition = {
  name: "diagnose_storage_pressure",
  description:
    "Diagnose local storage-pressure signals using statement digest counters and table storage metadata.",
  inputSchema: {
    ...diagnosticBaseInputShape,
    scope: diagnosticEnum("Diagnosis scope: instance, database, or table."),
    table: diagnosticString("Optional table to focus on when scope is table."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const diagnosticInput: DiagnoseStoragePressureInput = {
        ...parseBaseInput(input),
        scope: parseStorageScope(input.scope),
        table: asOptionalString(input.table, "table"),
      };
      const result = await deps.engine.diagnoseStoragePressure(diagnosticInput, ctx);
      return formatSuccess(toPublicDiagnosticResult(result), {
        summary: summarizeDiagnostic("Storage-pressure diagnosis", result.status),
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "diagnose_storage_pressure",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const diagnosticToolDefinitions: ToolDefinition[] = [
  diagnoseServiceLatencyTool,
  diagnoseDbHotspotTool,
  findTopSlowSqlTool,
  diagnoseSlowQueryTool,
  diagnoseConnectionSpikeTool,
  diagnoseLockContentionTool,
  diagnoseReplicationLagTool,
  diagnoseStoragePressureTool,
];

function diagnosticString(description: string) {
  return z.string().trim().min(1).optional().describe(description);
}

function diagnosticBoolean(description: string) {
  return z.boolean().optional().describe(description);
}

function diagnosticEnum(description: string) {
  return z.enum(["instance", "database", "table"]).optional().describe(description);
}
