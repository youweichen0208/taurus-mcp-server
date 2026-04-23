import { z } from "zod";
import {
  formatSuccess,
  type ToolResponse,
} from "../../utils/formatter.js";
import type {
  DiagnoseConnectionSpikeInput,
  DiagnoseLockContentionInput,
  DiagnoseReplicationLagInput,
  DiagnoseSlowQueryInput,
  DiagnoseStoragePressureInput,
} from "@huaweicloud/taurusdb-core";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asOptionalBoolean,
  asOptionalPositiveInteger,
  asOptionalString,
  diagnosticBaseInputShape,
  metadata,
  resolveContext,
  toPublicDiagnosticResult,
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

function summarizeDiagnostic(toolLabel: string, status: string): string {
  return `${toolLabel} returned ${status}.`;
}

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
    "Diagnose replication lag and replica replay pressure. This handler is scaffolded and currently returns a structured placeholder result.",
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
    "Diagnose storage, IOPS, and throughput pressure. This handler is scaffolded and currently returns a structured placeholder result.",
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
