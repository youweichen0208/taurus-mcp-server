import { z } from "zod";
import {
  buildRestoreRecycleBinTableSql,
  normalizeSql,
  sqlHash,
} from "taurusdb-core";
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

function sameRecoveryTarget(
  prepared: {
    datasource: string;
    host?: string;
    port?: number;
    projectId?: string;
    instanceId?: string;
    nodeId?: string;
  },
  current: {
    datasource: string;
    host?: string;
    port?: number;
    projectId?: string;
    instanceId?: string;
    nodeId?: string;
  },
): boolean {
  return prepared.datasource === current.datasource &&
    prepared.host === current.host &&
    prepared.port === current.port &&
    prepared.projectId === current.projectId &&
    prepared.instanceId === current.instanceId &&
    prepared.nodeId === current.nodeId;
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

export const prepareRecycleBinRestoreTool: ToolDefinition = {
  name: "prepare_recycle_bin_restore",
  description:
    "Prepare a short-lived local operator approval for one TaurusDB recycle-bin table. This tool performs readonly preflight only; the Agent cannot execute the restore.",
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
      if (!deps.recoveryApproval) {
        throw new ToolInputError("Controlled recycle-bin recovery approval is unavailable.");
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
        readonly: true,
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
      const issued = await deps.recoveryApproval.issue({
        target: {
          datasource: ctx.datasource,
          recycleTable,
          destinationDatabase,
          destinationTable,
        },
        execute: async (operator, requestId) => {
          const performRecovery = async () => {
            const startedAt = Date.now();
            let auditTool = "approve_recycle_bin_restore";
            try {
              const executionCtx = await deps.engine.resolveContext({
                datasource: ctx.datasource,
                database: destinationDatabase,
                timeout_ms: timeoutMs,
                readonly: false,
              }, requestId);
              if (!sameRecoveryTarget(ctx, executionCtx)) {
                throw new Error(
                  "Datasource target changed after recovery preflight. Create a new recovery request for the current target.",
                );
              }
              const currentProfile = await deps.profileLoader.get(ctx.datasource);
              if (!currentProfile?.user) {
                throw new Error("The SQL credential session is no longer available.");
              }
              const [currentRecycleBin, currentDestinationTables] = await Promise.all([
                deps.engine.listRecycleBin(executionCtx),
                deps.engine.listTables(executionCtx, destinationDatabase),
              ]);
              if (!recycleObjectExists(currentRecycleBin, recycleTable)) {
                throw new Error("Recycle-bin object is no longer available. Create a new recovery request.");
              }
              if (currentDestinationTables.some(
                (table) => table.name.toLowerCase() === destinationTable.toLowerCase(),
              )) {
                throw new Error("Destination table now exists. Controlled recovery will not overwrite it.");
              }
              await writeRecoveryAudit(deps, {
                requestId,
                actor: operator,
                datasource: executionCtx.datasource,
                database: destinationDatabase,
                sql: restoreSql,
                tool: auditTool,
                outcome: "success",
                durationMs: Date.now() - startedAt,
              });
              auditTool = "restore_recycle_bin_table";
              const result = await deps.engine.restoreRecycleBinTable(restoreInput, executionCtx, {
                timeoutMs,
              });
              const verifiedTables = await deps.engine.listTables(executionCtx, destinationDatabase);
              const verified = verifiedTables.some(
                (table) => table.name.toLowerCase() === destinationTable.toLowerCase(),
              );
              if (!verified) {
                throw new Error(
                  "Recovery command completed, but readonly destination verification failed. Inspect database state before retrying.",
                );
              }
              await writeRecoveryAudit(deps, {
                requestId,
                actor: operator,
                datasource: executionCtx.datasource,
                database: destinationDatabase,
                sql: restoreSql,
                tool: "restore_recycle_bin_table",
                outcome: "success",
                durationMs: Date.now() - startedAt,
              });
              return {
                queryId: result.queryId,
                affectedRows: result.affectedRows,
                verified,
              };
            } catch (error) {
              await writeRecoveryAudit(deps, {
                requestId,
                actor: operator,
                datasource: ctx.datasource,
                database: destinationDatabase,
                sql: restoreSql,
                tool: auditTool,
                outcome: "error",
                errorCode: "RECOVERY_FAILED",
                durationMs: Date.now() - startedAt,
              });
              throw error;
            }
          };
          return deps.sessionCoordinator
            ? deps.sessionCoordinator.runExclusive(performRecovery)
            : performRecovery();
        },
      });

      return formatSuccess({
        request_id: issued.requestId,
        status: "pending",
        approval_url: issued.approvalUrl,
        expires_at: issued.expiresAt,
        target: {
          datasource: ctx.datasource,
          recycle_table: recycleTable,
          destination_database: destinationDatabase,
          destination_table: destinationTable,
        },
        agent_can_execute: false,
      }, {
        summary: "Readonly preflight passed. A local operator must approve the recovery before it can execute.",
        metadata: metadata(context.taskId, {
          statement_type: "show",
          sql_hash: sqlHash(normalizeSql(restoreSql)),
        }),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "prepare_recycle_bin_restore",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const getRecycleBinRestoreStatusTool: ToolDefinition = {
  name: "get_recycle_bin_restore_status",
  description: "Get the status of a previously prepared recycle-bin recovery request.",
  inputSchema: {
    request_id: z.string().trim().min(1),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      if (!deps.recoveryApproval) {
        throw new ToolInputError("Controlled recycle-bin recovery is not enabled by the administrator.");
      }
      const requestId = asRequiredString(input.request_id, "request_id");
      const status = deps.recoveryApproval.getStatus(requestId);
      if (!status) throw new ToolInputError("Recovery request was not found or is no longer retained.");
      return formatSuccess({
        request_id: status.requestId,
        status: status.status,
        target: {
          datasource: status.target.datasource,
          recycle_table: status.target.recycleTable,
          destination_database: status.target.destinationDatabase,
          destination_table: status.target.destinationTable,
        },
        created_at: status.createdAt,
        expires_at: status.expiresAt,
        operator: status.operator,
        completed_at: status.completedAt,
        result: status.result ? {
          query_id: status.result.queryId,
          affected_rows: status.result.affectedRows,
          verified: status.result.verified,
        } : undefined,
        error: status.error,
      }, {
        summary: `Recovery request status: ${status.status}.`,
        metadata: metadata(context.taskId),
      });
    } catch (error) {
      return formatToolError(error, {
        action: "get_recycle_bin_restore_status",
        metadata: metadata(context.taskId),
      });
    }
  },
};
