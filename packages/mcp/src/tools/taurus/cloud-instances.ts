import {
  createCloudTaurusInstanceClient,
  type CloudTaurusInstanceSummary,
} from "@huaweicloud/taurusdb-core";
import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import { metadata } from "../common.js";

function toPublicInstance(item: CloudTaurusInstanceSummary) {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    mode: item.mode,
    region: item.region,
    datastore_version: item.datastoreVersion,
    vpc_id: item.vpcId,
    subnet_id: item.subnetId,
    private_ips: item.privateIps,
    public_ips: item.publicIps,
    hostnames: item.hostnames,
    port: item.port,
    node_ids: item.nodeIds,
    default_node_id: item.primaryNodeId,
    created: item.created,
    updated: item.updated,
  };
}

export const listCloudTaurusInstancesTool: ToolDefinition = {
  name: "list_cloud_taurus_instances",
  description:
    "List TaurusDB/GaussDB(for MySQL) instances visible to the configured Huawei Cloud project so the user can choose an instance id.",
  inputSchema: {
    name: z.string().trim().min(1).optional().describe("Optional fuzzy instance name filter."),
    id: z.string().trim().min(1).optional().describe("Optional exact instance id filter."),
    ip: z.string().trim().min(1).optional().describe("Optional private/public IP filter."),
    offset: z.number().int().min(0).optional().describe("Pagination offset. Defaults to 0."),
    limit: z.number().int().positive().max(100).optional().describe("Maximum number of instances to return. Defaults to 50."),
  },
  exposeWhen: (config) =>
    Boolean(
      config.cloud?.apiEndpoint &&
        (config.cloud?.authToken ||
          (config.cloud?.region &&
            config.cloud?.accessKeyId &&
            config.cloud?.secretAccessKey)),
    ),
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const client = createCloudTaurusInstanceClient(deps.config);
      if (!client) {
        throw new ToolInputError(
          "Cloud instance discovery is not configured. Provide TAURUSDB_CLOUD_REGION plus either TAURUSDB_CLOUD_AUTH_TOKEN or TAURUSDB_CLOUD_ACCESS_KEY_ID and TAURUSDB_CLOUD_SECRET_ACCESS_KEY.",
        );
      }

      const items = await client.list({
        name: typeof input.name === "string" ? input.name : undefined,
        id: typeof input.id === "string" ? input.id : undefined,
        ip: typeof input.ip === "string" ? input.ip : undefined,
        offset: typeof input.offset === "number" ? input.offset : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      });
      const projectId = await client.getProjectId();
      deps.config.cloud.projectId = deps.config.cloud.projectId ?? projectId;

      return formatSuccess(
        {
          items: items.map(toPublicInstance),
          total: items.length,
          cloud: {
            provider: deps.config.cloud.provider,
            region: deps.config.cloud.region,
            project_id: projectId,
          },
        },
        {
          summary:
            items.length === 1
              ? "Resolved 1 cloud TaurusDB instance."
              : `Resolved ${items.length} cloud TaurusDB instances.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_cloud_taurus_instances",
        metadata: metadata(context.taskId),
      });
    }
  },
};
