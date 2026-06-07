import {
  createCloudTaurusInstanceClient,
  TaurusDBEngine,
} from "taurusdb-core";
import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition, ToolDeps } from "../registry.js";
import { metadata } from "../common.js";

function buildHuaweiCloudEndpoint(service: string, region: string, domainSuffix: string): string {
  return `https://${service}.${region}.${domainSuffix}`;
}

function clearCloudSelection(deps: ToolDeps): void {
  deps.config.cloud.projectId = undefined;
  deps.config.cloud.instanceId = undefined;
  deps.config.cloud.nodeId = undefined;
  deps.config.slowSqlSource.taurusApi.projectId = undefined;
  deps.config.slowSqlSource.taurusApi.instanceId = undefined;
  deps.config.slowSqlSource.taurusApi.nodeId = undefined;
  deps.config.slowSqlSource.das.projectId = undefined;
  deps.config.slowSqlSource.das.instanceId = undefined;
  deps.config.metricsSource.ces.projectId = undefined;
  deps.config.metricsSource.ces.instanceId = undefined;
  deps.config.metricsSource.ces.nodeId = undefined;
  deps.profileLoader.clearAllRuntimeTargets();
}

async function reloadEngine(deps: ToolDeps): Promise<void> {
  const nextEngine = await TaurusDBEngine.create({
    config: deps.config,
    profileLoader: deps.profileLoader,
  });
  const previousEngine = deps.engine;
  deps.engine = nextEngine;
  if (previousEngine?.close) {
    await previousEngine.close();
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
  return input.publicIps[0] ?? input.privateIps[0] ?? input.hostnames[0];
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

      const domainSuffix = deps.config.cloud.domainSuffix ?? "myhuaweicloud.com";
      deps.config.cloud.region = region;
      deps.config.cloud.apiEndpoint = buildHuaweiCloudEndpoint("gaussdb", region, domainSuffix);
      deps.config.cloud.iamEndpoint = buildHuaweiCloudEndpoint("iam", region, domainSuffix);

      deps.config.slowSqlSource.taurusApi.endpoint = buildHuaweiCloudEndpoint(
        "gaussdb",
        region,
        domainSuffix,
      );
      deps.config.slowSqlSource.das.endpoint = buildHuaweiCloudEndpoint("das", region, domainSuffix);
      deps.config.metricsSource.ces.endpoint = buildHuaweiCloudEndpoint("ces", region, domainSuffix);

      clearCloudSelection(deps);
      await reloadEngine(deps);

      return formatSuccess(
        {
          region,
          api_endpoint: deps.config.cloud.apiEndpoint,
          iam_endpoint: deps.config.cloud.iamEndpoint,
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

      const profile = await deps.profileLoader.get(datasource);
      if (!profile) {
        throw new ToolInputError(`Datasource "${datasource}" was not found.`);
      }
      const currentTarget = deps.profileLoader.getRuntimeTarget(datasource);
      deps.profileLoader.setRuntimeTarget(datasource, {
        host: currentTarget?.host ?? profile.host,
        port: currentTarget?.port ?? profile.port,
        instanceId: currentTarget?.instanceId,
        nodeId: currentTarget?.nodeId,
        database,
      });

      await reloadEngine(deps);

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
      deps.profileLoader.clearRuntimeUser(datasource);

      await reloadEngine(deps);

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

      deps.config.cloud.projectId = projectId;
      deps.config.cloud.instanceId = matched.id;
      deps.config.cloud.nodeId = matched.primaryNodeId;
      deps.config.slowSqlSource.taurusApi.projectId = projectId;
      deps.config.slowSqlSource.taurusApi.instanceId = matched.id;
      deps.config.slowSqlSource.taurusApi.nodeId = matched.primaryNodeId;
      deps.config.slowSqlSource.das.projectId = projectId;
      deps.config.slowSqlSource.das.instanceId = matched.id;
      deps.config.metricsSource.ces.projectId = projectId;
      deps.config.metricsSource.ces.instanceId = matched.id;
      deps.config.metricsSource.ces.nodeId = matched.primaryNodeId;

      const boundDatasource = await resolveBindingDatasource(
        deps,
        typeof input.datasource === "string" ? input.datasource : undefined,
      );
      const selectedHost = selectInstanceAddress(matched);
      const selectedPort = normalizePort(matched.port);
      if (boundDatasource && selectedHost) {
        deps.profileLoader.setRuntimeTarget(boundDatasource, {
          host: selectedHost,
          port: selectedPort,
          instanceId: matched.id,
          nodeId: matched.primaryNodeId,
        });
      }

      await reloadEngine(deps);

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
