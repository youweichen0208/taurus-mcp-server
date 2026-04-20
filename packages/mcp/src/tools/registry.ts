import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  generateTaskId,
  logger,
  withTaskContext,
  type Config,
} from "@huaweicloud/taurusdb-core";
import type { ServerDeps } from "../server.js";
import {
  cancelQueryTool,
  executeReadonlySqlTool,
  executeSqlTool,
  explainSqlTool,
  getQueryStatusTool,
} from "./query.js";
import {
  describeTableTool,
  listDatabasesTool,
  listDataSourcesTool,
  listTablesTool,
  sampleRowsTool,
} from "./discovery.js";
import { pingTool } from "./ping.js";
import {
  ErrorCode,
  formatError,
  toMcpToolResult,
  type ToolResponse,
} from "../utils/formatter.js";

export type ToolDeps = ServerDeps;

export type ToolInvokeContext = {
  taskId: string;
};

export interface ToolDefinition<
  I extends Record<string, unknown> = Record<string, unknown>,
  O = unknown,
> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: I, deps: ToolDeps, context: ToolInvokeContext) => Promise<ToolResponse<O>>;
  exposeWhen?: (config: Config) => boolean;
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
    },
    handler: ToolHandler,
  ) => void;
};

function formatUnhandledToolError(error: unknown, taskId: string): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const response = formatError({
    code: ErrorCode.CONNECTION_FAILED,
    message,
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
      logger.info({ tool: tool.name }, "Tool invocation started");
      try {
        const response = await tool.handler(rawInput, deps, { taskId });
        logger.info(
          { tool: tool.name, ok: response.ok, durationMs: Date.now() - startedAt },
          "Tool invocation finished",
        );
        return toMcpToolResult(response);
      } catch (error) {
        logger.error({ err: error, tool: tool.name }, "Tool invocation failed with unhandled error");
        return formatUnhandledToolError(error, taskId);
      }
    });
  };

  if (typeof registrar.registerTool === "function") {
    registrar.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
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

export const defaultToolDefinitions: ToolDefinition[] = [
  pingTool,
  listDataSourcesTool,
  listDatabasesTool,
  listTablesTool,
  describeTableTool,
  sampleRowsTool,
  executeReadonlySqlTool,
  explainSqlTool,
  getQueryStatusTool,
  cancelQueryTool,
  executeSqlTool,
];

export function registerTools(
  server: McpServer,
  deps: ToolDeps,
  config: Config,
  tools: ToolDefinition[] = defaultToolDefinitions,
): void {
  for (const tool of tools) {
    if (tool.exposeWhen && !tool.exposeWhen(config)) {
      continue;
    }
    registerOneTool(server, tool, deps);
  }
}
