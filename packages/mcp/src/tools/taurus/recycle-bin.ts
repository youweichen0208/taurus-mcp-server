import { z } from "zod";
import { buildRestoreRecycleBinTableSql, normalizeSql, sqlHash } from "taurusdb-core";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  asOptionalPositiveInteger,
  asOptionalString,
  asRequiredString,
  contextInputShape,
  metadata,
  resolveContext,
  summarizeRows,
  toPublicQueryResult,
} from "../common.js";

function recycleObjectExists(
  result: Awaited<ReturnType<ToolDefinition["handler"]>> | unknown,
  recycleTable: string,
): boolean {
  if (!result || typeof result !== "object" || !("rows" in result)) return false;
  const rows = (result as { rows?: unknown[][] }).rows;
  return Array.isArray(rows) && rows.some((row) =>
    Array.isArray(row) && row.some((value) => String(value) === recycleTable));
}

async function writeRecoveryAudit(
  deps: Parameters<ToolDefinition["handler"]>[1],
  input: {
    requestId: string;
    actor: string;
    datasource: string;
    database: string;
    sql: string;
    tool: string;
    outcome: "success" | "error";
    errorCode?: string;
    durationMs: number;
  },
): Promise<void> {
  if (!deps.auditWriter) {
    throw new Error("Controlled recovery requires a durable audit writer.");
  }
  const profile = await deps.profileLoader.get(input.datasource);
  const target = deps.profileLoader.getRuntimeTarget(input.datasource);
  await deps.auditWriter.write({
    timestamp: new Date().toISOString(),
    task_id: input.requestId,
    tool: input.tool,
    actor: input.actor,
    datasource: input.datasource,
    database: input.database,
    host: profile?.host,
    port: profile?.port,
    project_id: deps.config.cloud.projectId,
    instance_id: target?.instanceId ?? profile?.instanceId ?? deps.config.cloud.instanceId,
    node_id: target?.nodeId ?? profile?.nodeId ?? deps.config.cloud.nodeId,
    sql_hash: sqlHash(normalizeSql(input.sql)),
    raw_sql: deps.config.audit.includeRawSql ? input.sql : undefined,
    decision: input.outcome === "success" ? "allowed" : "failed",
    outcome: input.outcome,
    error_code: input.errorCode,
    duration_ms: input.durationMs,
  });
}

export const listRecycleBinTool: ToolDefinition = {
  name: "list_recycle_bin",
  description:
    "List TaurusDB recycle bin tables. This is readonly and is intended for recovery triage after accidental DROP TABLE.",
  inputSchema: {
    datasource: contextInputShape.datasource,
    timeout_ms: contextInputShape.timeout_ms,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.listRecycleBin(ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          ...toPublicQueryResult(result),
        },
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            statement_type: "show",
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_recycle_bin",
        metadata: metadata(context.taskId, {
          statement_type: "show",
        }),
      });
    }
  },
};

export const restoreRecycleBinTableTool: ToolDefinition = {
  name: "restore_recycle_bin_table",
  description:
    "Restore one exact TaurusDB recycle-bin table after readonly existence and destination-collision checks. This performs a database mutation immediately and records the request and result in the audit log.",
  inputSchema: {
    datasource: contextInputShape.datasource,
    recycle_table: z.string().trim().min(1),
    destination_database: z.string().trim().min(1),
    destination_table: z.string().trim().min(1),
    timeout_ms: contextInputShape.timeout_ms,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      if (!deps.config.security.recycleBinRestoreEnabled) {
        throw new ToolInputError("Controlled recycle-bin recovery is not enabled by the administrator.");
      }
      if (!deps.auditWriter) {
        throw new ToolInputError("Controlled recycle-bin recovery requires durable audit persistence.");
      }
      const recycleTable = asRequiredString(input.recycle_table, "recycle_table");
      const destinationDatabase = asRequiredString(input.destination_database, "destination_database");
      const destinationTable = asRequiredString(input.destination_table, "destination_table");
      const timeoutMs = asOptionalPositiveInteger(input.timeout_ms, "timeout_ms");
      const datasource = asOptionalString(input.datasource, "datasource");
      const ctx = await deps.engine.resolveContext({
        datasource,
        database: destinationDatabase,
        timeout_ms: timeoutMs,
        readonly: false,
      }, context.taskId);
      const profile = await deps.profileLoader.get(ctx.datasource);
      if (!profile?.user) {
        throw new ToolInputError(
          `Datasource "${ctx.datasource}" has no active SQL credential session. Select the TaurusDB instance and open its returned local login URL first.`,
        );
      }

      const [recycleBin, destinationTables] = await Promise.all([
        deps.engine.listRecycleBin(ctx),
        deps.engine.listTables(ctx, destinationDatabase),
      ]);
      if (!recycleObjectExists(recycleBin, recycleTable)) {
        throw new ToolInputError(`Recycle-bin object "${recycleTable}" was not found during readonly preflight.`);
      }
      if (destinationTables.some((table) => table.name.toLowerCase() === destinationTable.toLowerCase())) {
        throw new ToolInputError(
          `Destination table "${destinationDatabase}.${destinationTable}" already exists. Controlled recovery never overwrites an existing table.`,
        );
      }

      const restoreInput = {
        recycleTable,
        method: "native_restore" as const,
        destinationDatabase,
        destinationTable,
      };
      const restoreSql = buildRestoreRecycleBinTableSql(restoreInput);
      const startedAt = Date.now();
      const client = deps.clientIdentityProvider?.();
      await writeRecoveryAudit(deps, {
        requestId: context.taskId,
        actor: client
          ? `mcp:${client.name}@${client.version}`
          : "unattributed-mcp-client",
        datasource: ctx.datasource,
        database: destinationDatabase,
        sql: restoreSql,
        tool: "restore_recycle_bin_table_requested",
        outcome: "success",
        durationMs: Date.now() - startedAt,
      });
      const result = await deps.engine.restoreRecycleBinTable(restoreInput, ctx, { timeoutMs });
      const verifiedTables = await deps.engine.listTables(ctx, destinationDatabase);
      const verified = verifiedTables.some(
        (table) => table.name.toLowerCase() === destinationTable.toLowerCase(),
      );
      if (!verified) {
        throw new Error(
          "Recovery command completed, but readonly destination verification failed. Inspect database state before retrying.",
        );
      }
      return formatSuccess({
        datasource: ctx.datasource,
        recycle_table: recycleTable,
        destination_database: destinationDatabase,
        destination_table: destinationTable,
        query_id: result.queryId,
        affected_rows: result.affectedRows,
        verified,
        execution_status: "executed",
      }, {
        summary: `Recycle-bin table restored and verified as ${destinationDatabase}.${destinationTable}.`,
        metadata: metadata(context.taskId, {
          statement_type: "unknown",
          sql_hash: sqlHash(normalizeSql(restoreSql)),
          duration_ms: result.durationMs,
        }),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "restore_recycle_bin_table",
        metadata: metadata(context.taskId),
      });
    }
  },
};
