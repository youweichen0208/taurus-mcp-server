import {
  createCloudTaurusInstanceClient,
  TaurusDBEngine,
  type Config,
  type RuntimeDataSourceTarget,
} from "taurusdb-core";
import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition, ToolDeps } from "../registry.js";
import { metadata } from "../common.js";

function buildHuaweiCloudEndpoint(service: string, region: string, domainSuffix: string): string {
  return `https://${service}.${region}.${domainSuffix}`;
}

function clearCloudSelection(config: Config, deps: ToolDeps): void {
  config.cloud.projectId = undefined;
  config.cloud.instanceId = undefined;
  config.cloud.nodeId = undefined;
  config.slowSqlSource.taurusApi.projectId = undefined;
  config.slowSqlSource.taurusApi.instanceId = undefined;
  config.slowSqlSource.taurusApi.nodeId = undefined;
  config.slowSqlSource.das.projectId = undefined;
  config.slowSqlSource.das.instanceId = undefined;
  config.metricsSource.ces.projectId = undefined;
  config.metricsSource.ces.instanceId = undefined;
  config.metricsSource.ces.nodeId = undefined;
  deps.profileLoader.clearAllRuntimeTargets();
}

async function snapshotRuntimeTargets(
  deps: ToolDeps,
): Promise<Map<string, RuntimeDataSourceTarget>> {
  const profiles = await deps.profileLoader.load();
  return new Map(
    [...profiles.keys()].flatMap((name) => {
      const target = deps.profileLoader.getRuntimeTarget(name);
      return target ? [[name, target] as const] : [];
    }),
  );
}

function restoreRuntimeTargets(
  deps: ToolDeps,
  targets: Map<string, RuntimeDataSourceTarget>,
): void {
  deps.profileLoader.clearAllRuntimeTargets();
  for (const [name, target] of targets) {
    deps.profileLoader.setRuntimeTarget(name, target);
  }
}

async function reloadEngine(deps: ToolDeps, nextConfig: Config): Promise<void> {
  const nextEngine = await TaurusDBEngine.create({
    config: nextConfig,
    profileLoader: deps.profileLoader,
  });
  const previousEngine = deps.engine;
  deps.config = nextConfig;
  deps.engine = nextEngine;
  if (previousEngine?.close) {
    await previousEngine.close();
  }
}

async function updateSessionState(
  deps: ToolDeps,
  mutate: (nextConfig: Config) => Promise<void> | void,
): Promise<void> {
  const nextConfig = structuredClone(deps.config);
  const previousTargets = await snapshotRuntimeTargets(deps);
  try {
    await mutate(nextConfig);
    await reloadEngine(deps, nextConfig);
  } catch (error) {
    restoreRuntimeTargets(deps, previousTargets);
    throw error;
  }
}

async function resolveBindingDatasource(
  deps: ToolDeps,
  explicit: string | undefined,
): Promise<string | undefined> {
  const trimmed = typeof explicit === "string" ? explicit.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  return deps.engine.getDefaultDataSource();
}

function selectInstanceAddress(input: {
  publicIps: string[];
  privateIps: string[];
  hostnames: string[];
}): string | undefined {
  return input.privateIps[0] ?? input.hostnames[0] ?? input.publicIps[0];
}

function normalizePort(port: string | number | undefined): number | undefined {
  if (typeof port === "number" && Number.isFinite(port)) {
    return port;
  }
  if (typeof port === "string" && /^\d+$/.test(port.trim())) {
    return Number.parseInt(port, 10);
  }
  return undefined;
}

function maskUsername(username: string | undefined): string | undefined {
  if (!username) {
    return undefined;
  }
  if (username.length <= 2) {
    return `${username[0]}*`;
  }
  return `${username.slice(0, 1)}***${username.slice(-1)}`;
}

export const setCloudRegionTool: ToolDefinition = {
  name: "set_cloud_region",
  description:
    "Update the active Huawei Cloud region for the current MCP session and reset any stale cloud project or instance selections.",
  inputSchema: {
    region: z.string().trim().min(1).describe("Huawei Cloud region id, for example cn-north-4."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const region = typeof input.region === "string" ? input.region.trim() : "";
      if (!region) {
        throw new ToolInputError("region is required.");
      }

      await updateSessionState(deps, (nextConfig) => {
        const domainSuffix = nextConfig.cloud.domainSuffix ?? "myhuaweicloud.com";
        nextConfig.cloud.region = region;
        nextConfig.cloud.apiEndpoint = buildHuaweiCloudEndpoint("gaussdb", region, domainSuffix);
        nextConfig.cloud.iamEndpoint = buildHuaweiCloudEndpoint("iam", region, domainSuffix);
        nextConfig.cloud.kmsEndpoint = buildHuaweiCloudEndpoint("kms", region, domainSuffix);
        nextConfig.slowSqlSource.taurusApi.endpoint = buildHuaweiCloudEndpoint(
          "gaussdb",
          region,
          domainSuffix,
        );
        nextConfig.slowSqlSource.das.endpoint = buildHuaweiCloudEndpoint(
          "das",
          region,
          domainSuffix,
        );
        nextConfig.metricsSource.ces.endpoint = buildHuaweiCloudEndpoint(
          "ces",
          region,
          domainSuffix,
        );
        clearCloudSelection(nextConfig, deps);
      });
      deps.credentialSessions?.clearAll();

      return formatSuccess(
        {
          region,
          api_endpoint: deps.config.cloud.apiEndpoint,
          iam_endpoint: deps.config.cloud.iamEndpoint,
          kms_endpoint: deps.config.cloud.kmsEndpoint,
        },
        {
          summary: `Cloud region switched to ${region}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "set_cloud_region",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const setDefaultDatabaseTool: ToolDefinition = {
  name: "set_default_database",
  description:
    "Set the default database for a datasource in the current MCP session so later tool calls can omit input.database.",
  inputSchema: {
    database: z
      .string()
      .trim()
      .min(1)
      .describe("Database name to bind as the session default for the selected datasource."),
    datasource: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional datasource template to bind. Defaults to the current default datasource."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const database = typeof input.database === "string" ? input.database.trim() : "";
      if (!database) {
        throw new ToolInputError("database is required.");
      }

      const datasource = await resolveBindingDatasource(
        deps,
        typeof input.datasource === "string" ? input.datasource : undefined,
      );
      if (!datasource) {
        throw new ToolInputError(
          "No datasource selected. Configure a default datasource or pass datasource explicitly.",
        );
      }

      const ctx = await deps.engine.resolveContext(
        {
          datasource,
          readonly: true,
        },
        context.taskId,
      );
      const databases = await deps.engine.listDatabases(ctx);
      if (!databases.some((item) => item.name === database)) {
        throw new ToolInputError(
          `Database "${database}" was not found on datasource "${datasource}". Run list_databases first and choose one of the returned names.`,
        );
      }
      const databaseContext = await deps.engine.resolveContext(
        {
          datasource,
          database,
          readonly: true,
        },
        context.taskId,
      );
      await deps.engine.listTables(databaseContext, database);

      const profile = await deps.profileLoader.get(datasource);
      if (!profile) {
        throw new ToolInputError(`Datasource "${datasource}" was not found.`);
      }
      const currentTarget = deps.profileLoader.getRuntimeTarget(datasource);
      await updateSessionState(deps, () => {
        deps.profileLoader.setRuntimeTarget(datasource, {
          host: currentTarget?.host ?? profile.host,
          port: currentTarget?.port ?? profile.port,
          instanceId: currentTarget?.instanceId,
          nodeId: currentTarget?.nodeId,
          database,
        });
      });

      return formatSuccess(
        {
          datasource,
          database,
        },
        {
          summary: `Default database for ${datasource} set to ${database} in the current session.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "set_default_database",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const clearSqlCredentialsTool: ToolDefinition = {
  name: "clear_sql_credentials",
  description:
    "Clear any session-scoped SQL credential override for a datasource and fall back to the configured profile credentials.",
  inputSchema: {
    datasource: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional datasource template to clear. Defaults to the current default datasource."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const datasource = await resolveBindingDatasource(
        deps,
        typeof input.datasource === "string" ? input.datasource : undefined,
      );
      if (!datasource) {
        throw new ToolInputError(
          "No datasource selected. Configure a default datasource or pass datasource explicitly.",
        );
      }

      const profile = await deps.profileLoader.get(datasource);
      if (!profile) {
        throw new ToolInputError(`Datasource "${datasource}" was not found.`);
      }
      await updateSessionState(deps, () => {
        deps.profileLoader.clearRuntimeUser(datasource);
      });
      deps.credentialSessions?.clear(datasource);

      return formatSuccess(
        {
          datasource,
        },
        {
          summary: `Session SQL credential override cleared for ${datasource}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "clear_sql_credentials",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const getSessionBindingTool: ToolDefinition = {
  name: "get_session_binding",
  description:
    "Return the current session binding for a datasource, including selected instance, host, database, and whether SQL credentials are overridden in memory.",
  inputSchema: {
    datasource: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional datasource template to inspect. Defaults to the current default datasource."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const datasource = await resolveBindingDatasource(
        deps,
        typeof input.datasource === "string" ? input.datasource : undefined,
      );
      if (!datasource) {
        throw new ToolInputError(
          "No datasource selected. Configure a default datasource or pass datasource explicitly.",
        );
      }

      const profile = await deps.profileLoader.get(datasource);
      if (!profile) {
        throw new ToolInputError(`Datasource "${datasource}" was not found.`);
      }
      const target = deps.profileLoader.getRuntimeTarget(datasource);

      return formatSuccess(
        {
          datasource,
          host: profile.host,
          port: profile.port,
          database: profile.database,
          username_masked: maskUsername(profile.user?.username),
          runtime_override: {
            instance_id: target?.instanceId,
            node_id: target?.nodeId,
            host: target?.host,
            port: target?.port,
            database: target?.database,
            has_sql_credentials_override: Boolean(target?.user),
            username_masked: maskUsername(target?.user?.username),
          },
        },
        {
          summary: `Returned current session binding for ${datasource}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "get_session_binding",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const selectCloudTaurusInstanceTool: ToolDefinition = {
  name: "select_cloud_taurus_instance",
  description:
    "Select the default TaurusDB cloud instance for the current session so diagnostics can reuse its instance id and default node id.",
  inputSchema: {
    instance_id: z.string().trim().min(1).describe("Exact TaurusDB instance id to bind into the current session."),
    datasource: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional datasource template to bind to this cloud instance. Defaults to the current default datasource."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const instanceId =
        typeof input.instance_id === "string" ? input.instance_id.trim() : "";
      if (!instanceId) {
        throw new ToolInputError("instance_id is required.");
      }

      const client = createCloudTaurusInstanceClient(deps.config);
      if (!client) {
        throw new ToolInputError(
          "Cloud instance selection is not configured. Set cloud region and either auth token or AK/SK first.",
        );
      }

      const [items, projectId] = await Promise.all([
        client.list({ id: instanceId, limit: 10 }),
        client.getProjectId(),
      ]);
      const matched = items.find((item: { id: string }) => item.id === instanceId);
      if (!matched) {
        throw new ToolInputError(`No TaurusDB cloud instance matched id ${instanceId}.`);
      }

      const boundDatasource = await resolveBindingDatasource(
        deps,
        typeof input.datasource === "string" ? input.datasource : undefined,
      );
      const selectedHost = selectInstanceAddress(matched);
      const selectedPort = normalizePort(matched.port);
      await updateSessionState(deps, (nextConfig) => {
        nextConfig.cloud.projectId = projectId;
        nextConfig.cloud.instanceId = matched.id;
        nextConfig.cloud.nodeId = matched.primaryNodeId;
        nextConfig.slowSqlSource.taurusApi.projectId = projectId;
        nextConfig.slowSqlSource.taurusApi.instanceId = matched.id;
        nextConfig.slowSqlSource.taurusApi.nodeId = matched.primaryNodeId;
        nextConfig.slowSqlSource.das.projectId = projectId;
        nextConfig.slowSqlSource.das.instanceId = matched.id;
        nextConfig.metricsSource.ces.projectId = projectId;
        nextConfig.metricsSource.ces.instanceId = matched.id;
        nextConfig.metricsSource.ces.nodeId = matched.primaryNodeId;
        if (boundDatasource && selectedHost) {
          deps.profileLoader.setRuntimeTarget(boundDatasource, {
            host: selectedHost,
            port: selectedPort,
            instanceId: matched.id,
            nodeId: matched.primaryNodeId,
          });
        }
      });
      if (boundDatasource) {
        deps.credentialSessions?.clear(boundDatasource);
      }

      return formatSuccess(
        {
          project_id: projectId,
          instance_id: matched.id,
          instance_name: matched.name,
          default_node_id: matched.primaryNodeId,
          private_ips: matched.privateIps,
          public_ips: matched.publicIps,
          hostnames: matched.hostnames,
          port: matched.port,
          bound_datasource: boundDatasource,
          bound_host: selectedHost,
          bound_port: selectedPort,
        },
        {
          summary: `Selected cloud instance ${matched.name} (${matched.id}).`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "select_cloud_taurus_instance",
        metadata: metadata(context.taskId),
      });
    }
  },
};
