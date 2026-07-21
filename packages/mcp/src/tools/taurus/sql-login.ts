import { TaurusDBEngine } from "taurusdb-core";
import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { metadata } from "../common.js";
import { formatToolError, ToolInputError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  SqlCredentialValidationError,
  type CredentialValidationFailure,
} from "../../security/local-credential-login.js";

const AUTH_ERROR_CODES = new Set([
  "ER_ACCESS_DENIED_ERROR",
  "ER_ACCESS_DENIED_NO_PASSWORD_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
]);
const VALIDATION_TIMEOUT_ERROR_CODES = new Set([
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "POOL_QUEUE_TIMEOUT",
]);

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") {
      codes.push(record.code.toUpperCase());
    }
    current = record.cause;
  }
  return codes;
}

function classifyValidationFailure(error: unknown): CredentialValidationFailure {
  const codes = errorCodes(error);
  if (codes.some((code) => AUTH_ERROR_CODES.has(code))) {
    return "credentials";
  }
  if (codes.includes("ECONNREFUSED")) {
    return "refused";
  }
  if (codes.includes("ETIMEDOUT") || codes.includes("EHOSTUNREACH") || codes.includes("ENETUNREACH")) {
    return "unreachable";
  }
  if (codes.some((code) => VALIDATION_TIMEOUT_ERROR_CODES.has(code))) {
    return "timeout";
  }
  if (codes.some((code) => code.includes("TLS") || code.includes("SSL") || code.includes("CERT") || code.includes("SIGNATURE"))) {
    return "tls";
  }
  return "connectivity";
}

async function expireCredentials(
  deps: Parameters<ToolDefinition["handler"]>[1],
  datasource: string,
): Promise<void> {
  const expire = async () => {
    deps.profileLoader.clearRuntimeUser(datasource);
    const previousEngine = deps.engine;
    if (previousEngine?.close) {
      await previousEngine.close();
    }
    deps.engine = await TaurusDBEngine.create({
      config: deps.config,
      profileLoader: deps.profileLoader,
    });
  };
  if (deps.sessionCoordinator) {
    await deps.sessionCoordinator.runExclusive(expire);
  } else {
    await expire();
  }
}

export async function issueSqlLoginForDatasource(
  deps: Parameters<ToolDefinition["handler"]>[1],
  datasource: string,
) {
  const profile = await deps.profileLoader.get(datasource);
  if (!profile) {
    throw new ToolInputError(`Datasource "${datasource}" was not found.`);
  }
  if (!profile.host) {
    throw new ToolInputError(
      `Datasource "${datasource}" does not define a database host. Select a TaurusDB instance before beginning SQL login.`,
    );
  }
  const runtimeTarget = deps.profileLoader.getRuntimeTarget(datasource);

  return deps.credentialLogin.issueSqlLogin({
    datasource,
    target: {
      datasource,
      instanceId:
        runtimeTarget?.instanceId ??
        profile.instanceId ??
        deps.config.cloud.instanceId,
      region: deps.config.cloud.region,
      credentialIdleTtlMinutes: deps.config.security.credentialIdleTtlMinutes,
      credentialMaxTtlMinutes: deps.config.security.credentialMaxTtlMinutes,
    },
    bind: async ({ username, password }) => {
      const bindCredentials = async () => {
        const currentTarget = deps.profileLoader.getRuntimeTarget(datasource);
        const restoreTarget = () => {
          deps.profileLoader.clearRuntimeTarget(datasource);
          if (currentTarget) {
            deps.profileLoader.setRuntimeTarget(datasource, currentTarget);
          }
        };
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

        let nextEngine: TaurusDBEngine | undefined;
        try {
          nextEngine = await TaurusDBEngine.create({
            config: deps.config,
            profileLoader: deps.profileLoader,
          });
          const validationTaskId = `credential_validation_${Date.now()}`;
          if (deps.sqlCredentialValidator) {
            await deps.sqlCredentialValidator(nextEngine, datasource, validationTaskId);
          } else {
            const validationContext = await nextEngine.resolveContext(
              { datasource, readonly: true },
              validationTaskId,
            );
            await nextEngine.executeReadonly("SELECT 1 AS ok", validationContext, {
              timeoutMs: Math.min(deps.config.limits.maxStatementMs, 10_000),
              maxRows: 1,
              maxColumns: 1,
              maxFieldChars: 16,
            });
          }
        } catch (error) {
          await nextEngine?.close().catch(() => undefined);
          restoreTarget();
          throw new SqlCredentialValidationError(classifyValidationFailure(error));
        }
        const previousEngine = deps.engine;
        try {
          if (previousEngine?.close) {
            await previousEngine.close();
          }
        } catch (error) {
          await nextEngine.close().catch(() => undefined);
          restoreTarget();
          try {
            deps.engine = await TaurusDBEngine.create({
              config: deps.config,
              profileLoader: deps.profileLoader,
            });
          } catch {
            deps.engine = previousEngine;
          }
          throw new SqlCredentialValidationError(classifyValidationFailure(error));
        }
        deps.engine = nextEngine;
        deps.credentialSessions?.activate(datasource, () =>
          expireCredentials(deps, datasource),
        );
      };
      if (deps.sessionCoordinator) {
        await deps.sessionCoordinator.runExclusive(bindCredentials);
      } else {
        await bindCredentials();
      }
    },
  });
}

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

      const issued = await issueSqlLoginForDatasource(deps, datasource);

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
