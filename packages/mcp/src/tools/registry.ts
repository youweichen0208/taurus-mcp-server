import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  generateTaskId,
  logger,
  withTaskContext,
  type Config,
} from "taurusdb-core";
import type { ServerDeps } from "../server.js";
import {
  executeReadonlySqlTool,
  executeSqlTool,
  explainSqlTool,
} from "./query.js";
import {
  describeTableTool,
  listDataSourcesTool,
  listDatabasesTool,
  listTablesTool,
} from "./discovery.js";
import { showProcesslistTool } from "./processlist.js";
import { pingTool } from "./ping.js";
import { getKernelInfoTool, listTaurusFeaturesTool } from "./taurus/capability.js";
import {
  clearSqlCredentialsTool,
  getSessionBindingTool,
  selectCloudTaurusInstanceTool,
  setCloudRegionTool,
  setDefaultDatabaseTool,
} from "./taurus/cloud-context.js";
import { beginSqlLoginTool } from "./taurus/sql-login.js";
import { listCloudTaurusInstancesTool } from "./taurus/cloud-instances.js";
import { diagnosticToolDefinitions } from "./taurus/diagnostics.js";
import { explainSqlEnhancedTool } from "./taurus/explain.js";
import { flashbackQueryTool } from "./taurus/flashback.js";
import { listRecycleBinTool, restoreRecycleBinTableTool } from "./taurus/recycle-bin.js";
import {
  ErrorCode,
  formatError,
  toMcpToolResult,
  type ToolResponse,
} from "../utils/formatter.js";

export type ToolDeps = ServerDeps;

export type ToolInvokeContext = {
  taskId: string;
  approvalActor?: string;
};

export interface ToolDefinition<
  I extends Record<string, unknown> = Record<string, unknown>,
  O = unknown,
> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  handler: (input: I, deps: ToolDeps, context: ToolInvokeContext) => Promise<ToolResponse<O>>;
}

type ToolHandler = (input: Record<string, unknown>) => Promise<CallToolResult>;

type ToolRegistrar = {
  tool?: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler,
  ) => void;
  registerTool?: (
    name: string,
    config: {
      description: string;
      inputSchema: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      annotations?: ToolAnnotations;
    },
    handler: ToolHandler,
  ) => void;
};

function formatUnhandledToolError(error: unknown, taskId: string): CallToolResult {
  void error;
  const response = formatError({
    code: ErrorCode.CONNECTION_FAILED,
    message: "Tool execution failed unexpectedly.",
    summary: "Tool execution failed unexpectedly.",
    metadata: { task_id: taskId },
    retryable: false,
  });
  return toMcpToolResult(response);
}

function registerOneTool(
  server: McpServer,
  tool: ToolDefinition,
  deps: ToolDeps,
): void {
  const registrar = server as unknown as ToolRegistrar;
  const wrappedHandler: ToolHandler = async (rawInput) => {
    const taskId = generateTaskId();
    return withTaskContext(taskId, async () => {
      const startedAt = Date.now();
      const invokeContext: ToolInvokeContext = { taskId };
      logger.info({ tool: tool.name }, "Tool invocation started");
      try {
        const invoke = () => tool.handler(rawInput, deps, invokeContext);
        const response = deps.sessionCoordinator
          ? SESSION_MUTATION_TOOLS.has(tool.name)
            ? await deps.sessionCoordinator.runExclusive(invoke)
            : await deps.sessionCoordinator.runShared(invoke)
          : await invoke();
        try {
          await writeAuditEvent(
            deps,
            tool.name,
            rawInput,
            response,
            invokeContext,
            Date.now() - startedAt,
          );
        } catch (auditError) {
          logger.fatal(
            { err: auditError, tool: tool.name },
            "Tool completed but audit persistence failed",
          );
          return toMcpToolResult(formatError({
            code: ErrorCode.AUDIT_FAILED,
            message:
              "The tool completed but its audit event could not be persisted. Verify database state before retrying.",
            summary: "Audit persistence failed after tool execution.",
            metadata: response.metadata,
            retryable: false,
          }));
        }
        logger.info(
          { tool: tool.name, ok: response.ok, durationMs: Date.now() - startedAt },
          "Tool invocation finished",
        );
        return toMcpToolResult(response);
      } catch (error) {
        logger.error({ err: error, tool: tool.name }, "Tool invocation failed with unhandled error");
        const fallback = formatUnhandledToolError(error, taskId);
        try {
          await writeAuditEvent(
            deps,
            tool.name,
            rawInput,
            fallback.structuredContent as unknown as ToolResponse,
            invokeContext,
            Date.now() - startedAt,
          );
        } catch (auditError) {
          logger.fatal(
            { err: auditError, tool: tool.name },
            "Unhandled tool failure could not be audited",
          );
        }
        return fallback;
      }
    });
  };

  if (typeof registrar.registerTool === "function") {
    const readOnly = !PRIVILEGED_TOOL_NAMES.has(tool.name);
    registrar.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: TOOL_OUTPUT_SHAPE,
        annotations: tool.annotations ?? {
          readOnlyHint: readOnly,
          destructiveHint: DATABASE_MUTATION_TOOLS.has(tool.name),
          idempotentHint:
            readOnly || IDEMPOTENT_SESSION_MUTATION_TOOLS.has(tool.name),
          openWorldHint: true,
        },
      },
      wrappedHandler,
    );
    return;
  }

  if (typeof registrar.tool === "function") {
    registrar.tool(tool.name, tool.description, tool.inputSchema, wrappedHandler);
    return;
  }

  throw new Error("Unsupported MCP SDK version: expected `tool` or `registerTool` on McpServer.");
}

const SESSION_MUTATION_TOOLS = new Set([
  "set_cloud_region",
  "begin_sql_login",
  "clear_sql_credentials",
  "set_default_database",
  "select_cloud_taurus_instance",
]);

const PRIVILEGED_TOOL_NAMES = new Set([
  ...SESSION_MUTATION_TOOLS,
  "execute_sql",
  "restore_recycle_bin_table",
]);

const DATABASE_MUTATION_TOOLS = new Set([
  "execute_sql",
  "restore_recycle_bin_table",
]);

const IDEMPOTENT_SESSION_MUTATION_TOOLS = new Set([
  "set_cloud_region",
  "clear_sql_credentials",
  "set_default_database",
  "select_cloud_taurus_instance",
]);

const TOOL_OUTPUT_SHAPE = {
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
  metadata: z.record(z.unknown()),
};

async function writeAuditEvent(
  deps: ToolDeps,
  tool: string,
  input: Record<string, unknown>,
  response: ToolResponse,
  context: ToolInvokeContext,
  durationMs: number,
): Promise<void> {
  if (!deps.auditWriter) {
    return;
  }
  const datasource =
    typeof input.datasource === "string"
      ? input.datasource
      : deps.config.defaultDatasource ?? (await deps.profileLoader.getDefault());
  const profile = datasource ? await deps.profileLoader.get(datasource) : undefined;
  const target = datasource
    ? deps.profileLoader.getRuntimeTarget(datasource)
    : undefined;
  const errorCode = response.error?.code;
  const decision =
    response.ok
      ? "allowed"
      : errorCode === ErrorCode.BLOCKED_SQL
        ? "blocked"
        : errorCode === ErrorCode.CONFIRMATION_REQUIRED
          ? "approval_required"
          : errorCode === ErrorCode.CONFIRMATION_INVALID
            ? "approval_denied"
            : "failed";
  await deps.auditWriter.write({
    timestamp: new Date().toISOString(),
    task_id: context.taskId,
    tool,
    actor:
      context.approvalActor ??
      (() => {
        const client = deps.clientIdentityProvider?.();
        return client
          ? `mcp:${client.name}@${client.version}`
          : "unattributed-mcp-client";
      })(),
    datasource,
    database:
      typeof input.database === "string" ? input.database : profile?.database,
    host: profile?.host,
    port: profile?.port,
    project_id: deps.config.cloud.projectId,
    instance_id:
      target?.instanceId ?? profile?.instanceId ?? deps.config.cloud.instanceId,
    node_id: target?.nodeId ?? profile?.nodeId ?? deps.config.cloud.nodeId,
    sql_hash: response.metadata.sql_hash,
    raw_sql:
      deps.config.audit.includeRawSql && typeof input.sql === "string"
        ? input.sql
        : undefined,
    decision,
    outcome: response.ok ? "success" : "error",
    error_code: errorCode,
    duration_ms: durationMs,
  });
}

export const commonToolDefinitions: ToolDefinition[] = [
  pingTool,
  listDataSourcesTool,
  listDatabasesTool,
  listTablesTool,
  describeTableTool,
  showProcesslistTool,
  executeReadonlySqlTool,
  explainSqlTool,
];

export const capabilityToolDefinitions: ToolDefinition[] = [
  getKernelInfoTool,
  listTaurusFeaturesTool,
  getSessionBindingTool,
  listCloudTaurusInstancesTool,
];

export const dynamicTargetToolDefinitions: ToolDefinition[] = [
  setCloudRegionTool,
  beginSqlLoginTool,
  clearSqlCredentialsTool,
  setDefaultDatabaseTool,
  selectCloudTaurusInstanceTool,
];

export const taurusToolDefinitions: ToolDefinition[] = [
  explainSqlEnhancedTool,
  flashbackQueryTool,
  listRecycleBinTool,
];

export const mutationToolDefinitions: ToolDefinition[] = [
  executeSqlTool,
  restoreRecycleBinTableTool,
];

function buildDefaultToolDefinitions(config: Config): ToolDefinition[] {
  return [
    ...commonToolDefinitions,
    ...capabilityToolDefinitions,
    ...(config.security.dynamicTargetsEnabled ? dynamicTargetToolDefinitions : []),
    ...diagnosticToolDefinitions,
    ...taurusToolDefinitions,
    ...(config.security.mutationsEnabled ? mutationToolDefinitions : []),
  ];
}

export function registerTools(
  server: McpServer,
  deps: ToolDeps,
  config: Config,
  tools: ToolDefinition[] = buildDefaultToolDefinitions(config),
): void {
  for (const tool of tools) {
    registerOneTool(server, tool, deps);
  }
}
