import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createSqlProfileLoader,
  getConfig,
  RuntimeOverrideProfileLoader,
  redactConfigForLog,
  TaurusDBEngine,
  type Config,
  type RuntimeTargetProfileLoader,
} from "taurusdb-core";
import { registerTools } from "./tools/registry.js";
import { logger } from "taurusdb-core";
import { VERSION } from "./version.js";
import {
  LocalCredentialLoginService,
  type CredentialLoginService,
} from "./security/local-credential-login.js";

export interface ServerDeps {
  config: Config;
  profileLoader: RuntimeTargetProfileLoader;
  engine: TaurusDBEngine;
  credentialLogin: CredentialLoginService;
  pingResponse: string;
}

export async function bootstrapDependencies(): Promise<ServerDeps> {
  const config = getConfig();
  const profileLoader = new RuntimeOverrideProfileLoader(
    createSqlProfileLoader({ config }),
  );
  const engine = await TaurusDBEngine.create({ config, profileLoader });

  return {
    config,
    profileLoader,
    engine,
    credentialLogin: new LocalCredentialLoginService(),
    pingResponse: "pong",
  };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "huaweicloud-taurusdb",
    version: VERSION,
  });

  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= Promise.all([
      deps.credentialLogin.close(),
      deps.engine.close(),
    ]).then(() => undefined);
    return cleanupPromise;
  };

  server.server.onclose = () => {
    void cleanup().catch((error: unknown) => {
      logger.error({ err: error }, "Failed to close MCP session dependencies");
    });
  };

  const closeServer = server.close.bind(server);
  server.close = async () => {
    await closeServer();
    await cleanup();
  };

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
