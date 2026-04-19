import {
  createSqlProfileLoader,
  type ProfileLoader,
} from "./auth/sql-profile-loader.js";
import {
  createSecretResolver,
  type SecretResolver,
} from "./auth/secret-resolver.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig, redactConfigForLog, type Config } from "./config/index.js";
import { createDatasourceResolver } from "./context/datasource-resolver.js";
import type { DatasourceResolver } from "./context/session-context.js";
import {
  createConnectionPoolManager,
  type ConnectionPool,
} from "./executor/connection-pool.js";
import {
  createSchemaIntrospector,
  type SchemaIntrospector,
} from "./schema/introspector.js";
import { createMySqlSchemaAdapter } from "./schema/adapters/mysql.js";
import { createSchemaCache, type SchemaCache } from "./schema/cache.js";
import { registerTools } from "./tools/registry.js";
import { logger } from "./utils/logger.js";
import { VERSION } from "./version.js";

export interface ServerDeps {
  config: Config;
  profileLoader: ProfileLoader;
  secretResolver: SecretResolver;
  datasourceResolver: DatasourceResolver;
  connectionPool: ConnectionPool;
  schemaCache: SchemaCache;
  schemaIntrospector: SchemaIntrospector;
  pingResponse: string;
}

export async function bootstrapDependencies(): Promise<ServerDeps> {
  const config = getConfig();
  const profileLoader = createSqlProfileLoader({ config });
  const secretResolver = createSecretResolver();
  const datasourceResolver = createDatasourceResolver({
    config,
    profileLoader,
  });
  const connectionPool = createConnectionPoolManager({
    config,
    profileLoader,
    secretResolver,
    adapters: {},
  });
  const schemaCache = createSchemaCache();
  const schemaIntrospector = createSchemaIntrospector({
    adapters: {
      mysql: createMySqlSchemaAdapter({ connectionPool, schemaCache }),
    },
  });
  return {
    config,
    profileLoader,
    secretResolver,
    datasourceResolver,
    connectionPool,
    schemaCache,
    schemaIntrospector,
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
  const profiles = await deps.profileLoader.load();
  const defaultDatasource = await deps.profileLoader.getDefault();
  const server = createServer(deps);
  logger.info(
    { config: redactConfigForLog(deps.config) },
    "Loaded effective config"
  );
  logger.info(
    {
      profileCount: profiles.size,
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
