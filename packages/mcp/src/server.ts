import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getConfig,
  redactConfigForLog,
  TaurusDBEngine,
  type Config,
} from "@huaweicloud/taurusdb-core";
import { registerTools } from "./tools/registry.js";
import { logger } from "@huaweicloud/taurusdb-core";
import { VERSION } from "./version.js";

export interface ServerDeps {
  config: Config;
  engine: TaurusDBEngine;
  pingResponse: string;
}

export async function bootstrapDependencies(): Promise<ServerDeps> {
  const config = getConfig();
  const engine = await TaurusDBEngine.create({ config });

  return {
    config,
    engine,
    pingResponse: "pong",
  };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "huaweicloud-taurusdb",
    version: VERSION,
  });

  registerTools(server, deps, deps.config);
  return server;
}

export async function startMcpServer(): Promise<void> {
  const deps = await bootstrapDependencies();
  const [datasources, defaultDatasource] = await Promise.all([
    deps.engine.listDataSources(),
    deps.engine.getDefaultDataSource(),
  ]);
  const server = createServer(deps);

  logger.info(
    { config: redactConfigForLog(deps.config) },
    "Loaded effective config"
  );
  logger.info(
    {
      profileCount: datasources.length,
      defaultDatasource: defaultDatasource ?? null,
    },
    "SQL profiles resolved"
  );
  logger.info(
    { server: "huaweicloud-taurusdb", version: VERSION },
    "Starting MCP server"
  );

  await server.connect(new StdioServerTransport());

  logger.info(
    { server: "huaweicloud-taurusdb" },
    "MCP server connected to stdio transport"
  );
}
