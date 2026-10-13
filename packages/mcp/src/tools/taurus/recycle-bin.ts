import { z } from "zod";
import { buildRestoreRecycleBinTableSql, normalizeSql, sqlHash } from "taurusdb-core";
import { ErrorCode, formatError, formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { resolveSessionTarget, sameSessionTarget } from "../../security/session-target.js";
import { formatToolError, ToolInputError, UnrecognizedResultFormatError } from "../error-handling.js";
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

/**
 * Columns that carry the recycle-bin object identifier passed to
 * dbms_recyclebin.restore_table(). Origin schema/table columns are deliberately
 * excluded so a dropped table's original name can never satisfy the preflight.
 */
const RECYCLE_OBJECT_COLUMNS = new Set([
  "table",
  "table_name",
  "recycle_table",
  "recycled_table",
  "recycle_name",
  "recycled_name",
  "recyclebin_name",
]);

export function recycleObjectExists(
  result: { columns?: Array<{ name: string }>; rows?: unknown[][] },
  recycleTable: string,
): boolean {
  const columns = (result.columns ?? []).map((column) => column.name);
  const identifierIndexes = columns.flatMap((name, index) =>
    RECYCLE_OBJECT_COLUMNS.has(name.toLowerCase()) ? [index] : []);
  if (identifierIndexes.length === 0) {
    throw new UnrecognizedResultFormatError(
      `The recycle-bin listing has no recognized object identifier column (columns: ${columns.join(", ") || "none"}). Recovery was not attempted.`,
    );
  }
  return (result.rows ?? []).some((row) =>
    Array.isArray(row) &&
    identifierIndexes.some((index) => row[index] !== null && row[index] !== undefined && String(row[index]) === recycleTable));
}

type RecoveryAuditTarget = {
  datasource: string;
  database: string;
  host?: string;
  port?: number;
  projectId?: string;
  instanceId?: string;
  nodeId?: string;
  sqlHash: string;
  rawSql?: string;
  recovery: {
    recycle_table: string;
    destination_database: string;
    destination_table: string;
  };
};

async function captureRecoveryAuditTarget(
  deps: Parameters<ToolDefinition["handler"]>[1],
  input: {
    datasource: string;
    recycleTable: string;
    destinationDatabase: string;
    destinationTable: string;
    sql: string;
  },
): Promise<RecoveryAuditTarget> {
  const profile = await deps.profileLoader.get(input.datasource);
  const target = deps.profileLoader.getRuntimeTarget(input.datasource);
  return Object.freeze({
    datasource: input.datasource,
    database: input.destinationDatabase,
    host: target?.host ?? profile?.host,
    port: target?.port ?? profile?.port,
    projectId: deps.config.cloud.projectId,
    instanceId: target?.instanceId ?? profile?.instanceId ?? deps.config.cloud.instanceId,
    nodeId: target?.nodeId ?? profile?.nodeId ?? deps.config.cloud.nodeId,
    sqlHash: sqlHash(normalizeSql(input.sql)),
    rawSql: deps.config.audit.includeRawSql ? input.sql : undefined,
    recovery: Object.freeze({
      recycle_table: input.recycleTable,
      destination_database: input.destinationDatabase,
      destination_table: input.destinationTable,
    }),
  });
}

async function writeRecoveryAudit(
  deps: Parameters<ToolDefinition["handler"]>[1],
  target: RecoveryAuditTarget,
  input: {
    requestId: string;
    actor: string;
    tool: string;
    outcome: "success" | "error";
    errorCode?: string;
    durationMs: number;
  },
): Promise<void> {
  if (!deps.auditWriter) {
    throw new Error("Controlled recovery requires a durable audit writer.");
  }
  await deps.auditWriter.write({
    timestamp: new Date().toISOString(),
    task_id: input.requestId,
    tool: input.tool,
    actor: input.actor,
    datasource: target.datasource,
    database: target.database,
    host: target.host,
    port: target.port,
    project_id: target.projectId,
    instance_id: target.instanceId,
    node_id: target.nodeId,
    sql_hash: target.sqlHash,
    raw_sql: target.rawSql,
    decision: input.outcome === "success" ? "allowed" : "failed",
    outcome: input.outcome,
    error_code: input.errorCode,
    duration_ms: input.durationMs,
    recovery: { ...target.recovery },
  });
}

function recoveryStateUncertain(
  message: string,
  taskId: string,
  sqlHashValue: string,
  details: Record<string, unknown>,
): ToolResponse {
  return formatError({
    code: ErrorCode.RECOVERY_STATE_UNCERTAIN,
    message: `${message} Inspect the destination table and recycle bin before retrying; do not retry blindly.`,
    summary: "Recycle-bin restore was sent to the database, but its final state could not be confirmed.",
    metadata: metadata(taskId, { statement_type: "unknown", sql_hash: sqlHashValue }),
    retryable: false,
    details,
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
      const activeBinding = deps.credentialSessions?.getActiveBinding(ctx.datasource);
      const liveTarget = await resolveSessionTarget(deps, ctx.datasource);
      const runtimeUser = deps.profileLoader.getRuntimeTarget(ctx.datasource)?.user;
      if (!activeBinding || !runtimeUser || !liveTarget || !sameSessionTarget(activeBinding, liveTarget)) {
        return formatError({
          code: ErrorCode.SQL_SESSION_REQUIRED,
          message: `Datasource "${ctx.datasource}" has no unexpired SQL login session bound to the currently selected target. Select the TaurusDB instance and complete its returned local login URL first; configured static credentials cannot authorize recovery.`,
          summary: "Recycle-bin restore requires an active login session for the selected target.",
          metadata: metadata(context.taskId),
          retryable: false,
        });
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
      // Capture the audit target once, before execution, so every record for
      // this request describes the same instance and objects.
      const auditTarget = await captureRecoveryAuditTarget(deps, {
        datasource: ctx.datasource,
        recycleTable,
        destinationDatabase,
        destinationTable,
        sql: restoreSql,
      });
      const startedAt = Date.now();
      const client = deps.clientIdentityProvider?.();
      const actor = client
        ? `mcp:${client.name}@${client.version}`
        : "unattributed-mcp-client";
      const audit = (tool: string, outcome: "success" | "error", errorCode?: string) =>
        writeRecoveryAudit(deps, auditTarget, {
          requestId: context.taskId,
          actor,
          tool,
          outcome,
          errorCode,
          durationMs: Date.now() - startedAt,
        });
      try {
        await audit("restore_recycle_bin_table_requested", "success");
      } catch {
        return formatError({
          code: ErrorCode.AUDIT_FAILED,
          message: "The recovery request could not be written to the audit log, so the restore was not started.",
          summary: "Recycle-bin restore was not started because audit persistence failed.",
          metadata: metadata(context.taskId, { sql_hash: auditTarget.sqlHash }),
          retryable: true,
        });
      }

      let result: Awaited<ReturnType<typeof deps.engine.restoreRecycleBinTable>>;
      try {
        result = await deps.engine.restoreRecycleBinTable(restoreInput, ctx, { timeoutMs });
      } catch (error) {
        await audit("restore_recycle_bin_table_failed", "error", "RESTORE_FAILED").catch(() => undefined);
        throw error;
      }

      const uncertainDetails = {
        recycle_table: recycleTable,
        destination_database: destinationDatabase,
        destination_table: destinationTable,
        instance_id: auditTarget.instanceId,
        query_id: result.queryId,
      };
      let verified: boolean;
      try {
        const verifiedTables = await deps.engine.listTables(ctx, destinationDatabase);
        verified = verifiedTables.some(
          (table) => table.name.toLowerCase() === destinationTable.toLowerCase(),
        );
      } catch {
        await audit("restore_recycle_bin_table_unverified", "error", "VERIFICATION_FAILED").catch(() => undefined);
        return recoveryStateUncertain(
          "The restore command completed, but readonly destination verification could not run.",
          context.taskId,
          auditTarget.sqlHash,
          uncertainDetails,
        );
      }
      if (!verified) {
        await audit("restore_recycle_bin_table_unverified", "error", "DESTINATION_NOT_FOUND").catch(() => undefined);
        return recoveryStateUncertain(
          "The restore command completed, but the destination table was not visible during readonly verification.",
          context.taskId,
          auditTarget.sqlHash,
          uncertainDetails,
        );
      }
      try {
        await audit("restore_recycle_bin_table_completed", "success");
      } catch {
        return formatError({
          code: ErrorCode.AUDIT_FAILED,
          message: "The restore completed and was verified, but its completion could not be written to the audit log. Record the outcome manually and confirm database state before any retry.",
          summary: "Recycle-bin restore completed, but completion audit failed.",
          metadata: metadata(context.taskId, { sql_hash: auditTarget.sqlHash }),
          retryable: false,
          details: { ...uncertainDetails, verified: true },
        });
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
          sql_hash: auditTarget.sqlHash,
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
