import { TaurusDBEngine } from "taurusdb-core";
import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { metadata } from "../common.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";

export const beginSqlLoginTool: ToolDefinition = {
  name: "begin_sql_login",
  description:
    "Create a short-lived local login URL where the user can enter SQL credentials without sending the password through the Agent or MCP tool arguments.",
  inputSchema: {
    datasource: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional datasource template. Defaults to the current default datasource."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const explicit = typeof input.datasource === "string" ? input.datasource.trim() : "";
      const datasource = explicit || (await deps.engine.getDefaultDataSource());
      if (!datasource) {
        throw new ToolInputError(
          "No datasource selected. Configure a default datasource or pass datasource explicitly.",
        );
      }

      const profile = await deps.profileLoader.get(datasource);
      if (!profile) {
        throw new ToolInputError(`Datasource "${datasource}" was not found.`);
      }

      const issued = await deps.credentialLogin.issueSqlLogin({
        datasource,
        bind: async ({ username, password }) => {
          const currentTarget = deps.profileLoader.getRuntimeTarget(datasource);
          deps.profileLoader.setRuntimeTarget(datasource, {
            host: currentTarget?.host ?? profile.host,
            port: currentTarget?.port ?? profile.port,
            database: currentTarget?.database ?? profile.database,
            instanceId: currentTarget?.instanceId,
            nodeId: currentTarget?.nodeId,
            user: {
              username,
              password: { type: "plain", value: password },
            },
          });

          const nextEngine = await TaurusDBEngine.create({
            config: deps.config,
            profileLoader: deps.profileLoader,
          });
          const previousEngine = deps.engine;
          deps.engine = nextEngine;
          if (previousEngine?.close) {
            await previousEngine.close();
          }
        },
      });

      return formatSuccess(
        {
          datasource,
          login_url: issued.loginUrl,
          expires_at: issued.expiresAt,
        },
        {
          summary: `Created a secure local SQL login link for ${datasource}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "begin_sql_login",
        metadata: metadata(context.taskId),
      });
    }
  },
};
