import os from "node:os";
import path from "node:path";
import { ConfigSchema, type Config } from "./schema.js";

export type { Config } from "./schema.js";

type MaybeString = string | undefined;

let configSingleton: Config | undefined;

function readString(value: MaybeString): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: MaybeString, name: string): boolean | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === undefined) {
    return undefined;
  }

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  throw new Error(
    `Invalid boolean for ${name}: "${value}". Expected one of true/false/1/0/yes/no/on/off.`,
  );
}

function parseInteger(value: MaybeString, name: string): number | undefined {
  const normalized = readString(value);
  if (normalized === undefined) {
    return undefined;
  }

  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`Invalid integer for ${name}: "${value}".`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for ${name}: "${value}".`);
  }
  return parsed;
}

function expandTildePath(inputPath: string | undefined): string | undefined {
  if (!inputPath) {
    return undefined;
  }

  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function buildRawConfigFromEnv(
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  return {
    defaultDatasource: readString(env.TAURUSDB_DEFAULT_DATASOURCE),
    profilesPath: expandTildePath(readString(env.TAURUSDB_SQL_PROFILES)),
    enableMutations: parseBoolean(
      env.TAURUSDB_MCP_ENABLE_MUTATIONS,
      "TAURUSDB_MCP_ENABLE_MUTATIONS",
    ),
    limits: {
      maxRows: parseInteger(env.TAURUSDB_MCP_MAX_ROWS, "TAURUSDB_MCP_MAX_ROWS"),
      maxColumns: parseInteger(
        env.TAURUSDB_MCP_MAX_COLUMNS,
        "TAURUSDB_MCP_MAX_COLUMNS",
      ),
      maxStatementMs: parseInteger(
        env.TAURUSDB_MCP_MAX_STATEMENT_MS,
        "TAURUSDB_MCP_MAX_STATEMENT_MS",
      ),
      maxFieldChars: parseInteger(
        env.TAURUSDB_MCP_MAX_FIELD_CHARS,
        "TAURUSDB_MCP_MAX_FIELD_CHARS",
      ),
    },
    audit: {
      logPath: expandTildePath(readString(env.TAURUSDB_MCP_AUDIT_LOG_PATH)),
      includeRawSql: parseBoolean(
        env.TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL,
        "TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL",
      ),
    },
    slowSqlSource: {
      taurusApi: {
        enabled: parseBoolean(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED,
          "TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED",
        ),
        endpoint: readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENDPOINT),
        projectId: readString(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_PROJECT_ID,
        ),
        instanceId: readString(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_INSTANCE_ID,
        ),
        nodeId: readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_NODE_ID),
        authToken: readString(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_AUTH_TOKEN,
        ),
        language: readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_LANGUAGE),
        requestTimeoutMs: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_TIMEOUT_MS,
          "TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_TIMEOUT_MS",
        ),
        defaultLookbackMinutes: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_DEFAULT_LOOKBACK_MINUTES,
          "TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_DEFAULT_LOOKBACK_MINUTES",
        ),
        maxRecords: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_MAX_RECORDS,
          "TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_MAX_RECORDS",
        ),
      },
      das: {
        enabled: parseBoolean(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED,
          "TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED",
        ),
        endpoint: readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT),
        projectId: readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_PROJECT_ID),
        instanceId: readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_INSTANCE_ID),
        authToken: readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_AUTH_TOKEN),
        datastoreType: readString(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_DATASTORE_TYPE,
        ),
        requestTimeoutMs: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_TIMEOUT_MS,
          "TAURUSDB_SLOW_SQL_SOURCE_DAS_TIMEOUT_MS",
        ),
        defaultLookbackMinutes: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_DEFAULT_LOOKBACK_MINUTES,
          "TAURUSDB_SLOW_SQL_SOURCE_DAS_DEFAULT_LOOKBACK_MINUTES",
        ),
        maxRecords: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_MAX_RECORDS,
          "TAURUSDB_SLOW_SQL_SOURCE_DAS_MAX_RECORDS",
        ),
        maxPages: parseInteger(
          env.TAURUSDB_SLOW_SQL_SOURCE_DAS_MAX_PAGES,
          "TAURUSDB_SLOW_SQL_SOURCE_DAS_MAX_PAGES",
        ),
      },
    },
    metricsSource: {
      ces: {
        enabled: parseBoolean(
          env.TAURUSDB_METRICS_SOURCE_CES_ENABLED,
          "TAURUSDB_METRICS_SOURCE_CES_ENABLED",
        ),
        endpoint: readString(env.TAURUSDB_METRICS_SOURCE_CES_ENDPOINT),
        projectId: readString(env.TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID),
        instanceId: readString(env.TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID),
        nodeId: readString(env.TAURUSDB_METRICS_SOURCE_CES_NODE_ID),
        authToken: readString(env.TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN),
        namespace: readString(env.TAURUSDB_METRICS_SOURCE_CES_NAMESPACE),
        instanceDimension: readString(
          env.TAURUSDB_METRICS_SOURCE_CES_INSTANCE_DIMENSION,
        ),
        nodeDimension: readString(
          env.TAURUSDB_METRICS_SOURCE_CES_NODE_DIMENSION,
        ),
        period: readString(env.TAURUSDB_METRICS_SOURCE_CES_PERIOD),
        filter: readString(env.TAURUSDB_METRICS_SOURCE_CES_FILTER),
        requestTimeoutMs: parseInteger(
          env.TAURUSDB_METRICS_SOURCE_CES_TIMEOUT_MS,
          "TAURUSDB_METRICS_SOURCE_CES_TIMEOUT_MS",
        ),
        defaultLookbackMinutes: parseInteger(
          env.TAURUSDB_METRICS_SOURCE_CES_DEFAULT_LOOKBACK_MINUTES,
          "TAURUSDB_METRICS_SOURCE_CES_DEFAULT_LOOKBACK_MINUTES",
        ),
      },
    },
  };
}

export function createConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const parsed = ConfigSchema.safeParse(buildRawConfigFromEnv(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

export function getConfig(): Config {
  if (!configSingleton) {
    configSingleton = createConfigFromEnv(process.env);
  }
  return configSingleton;
}

export function resetConfigForTests(): void {
  configSingleton = undefined;
}

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|credential|apikey|api_key)/i;

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : deepRedact(nestedValue);
    }
    return output;
  }

  return value;
}

export function redactConfigForLog(config: Config): Record<string, unknown> {
  return deepRedact(config) as Record<string, unknown>;
}
