import os from "node:os";
import path from "node:path";

type MaybeString = string | undefined;

const HUAWEI_CLOUD_DEFAULT_DOMAIN_SUFFIX = "myhuaweicloud.com";
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/i;

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

function pickFirstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function hasSqlTemplateInputs(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    readString(env.TAURUSDB_SQL_DSN) ||
      readString(env.TAURUSDB_SQL_HOST) ||
      readString(env.TAURUSDB_SQL_DATABASE) ||
      readString(env.TAURUSDB_SQL_USER) ||
      readString(env.TAURUSDB_SQL_PASSWORD),
  );
}

function inferRegionFromValue(value: MaybeString): string | undefined {
  const normalized = readString(value);
  if (!normalized) {
    return undefined;
  }

  const directMatch = normalized.match(REGION_PATTERN);
  if (directMatch) {
    return directMatch[0].toLowerCase();
  }

  try {
    const hostname = normalized.includes("://")
      ? new URL(normalized).hostname
      : normalized;
    const labels = hostname.split(".");
    for (const label of labels) {
      if (REGION_PATTERN.test(label)) {
        return label.toLowerCase();
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildHuaweiCloudEndpoint(
  service: string,
  region: string | undefined,
  domainSuffix: string | undefined,
): string | undefined {
  if (!region) {
    return undefined;
  }
  return `https://${service}.${region}.${domainSuffix ?? HUAWEI_CLOUD_DEFAULT_DOMAIN_SUFFIX}`;
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

export function buildRawConfigFromEnv(
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const cloudDasEnabled = parseBoolean(
    env.TAURUSDB_CLOUD_ENABLE_DAS,
    "TAURUSDB_CLOUD_ENABLE_DAS",
  );
  const cloudCesEnabled = parseBoolean(
    env.TAURUSDB_CLOUD_ENABLE_CES,
    "TAURUSDB_CLOUD_ENABLE_CES",
  );
  const cloudTaurusApiEnabled = parseBoolean(
    env.TAURUSDB_CLOUD_ENABLE_TAURUS_API,
    "TAURUSDB_CLOUD_ENABLE_TAURUS_API",
  );
  const cloudDomainSuffix =
    readString(env.TAURUSDB_CLOUD_DOMAIN_SUFFIX) ??
    HUAWEI_CLOUD_DEFAULT_DOMAIN_SUFFIX;
  const cloudRegion = pickFirstDefined(
    readString(env.TAURUSDB_CLOUD_REGION),
    inferRegionFromValue(env.TAURUSDB_SQL_HOST),
    inferRegionFromValue(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT),
    inferRegionFromValue(env.TAURUSDB_METRICS_SOURCE_CES_ENDPOINT),
    inferRegionFromValue(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENDPOINT),
  );
  const cloudProjectId = readString(env.TAURUSDB_CLOUD_PROJECT_ID);
  const cloudInstanceId = readString(env.TAURUSDB_CLOUD_INSTANCE_ID);
  const cloudNodeId = readString(env.TAURUSDB_CLOUD_NODE_ID);
  const cloudAuthToken = readString(env.TAURUSDB_CLOUD_AUTH_TOKEN);
  const cloudAccessKeyId = pickFirstDefined(
    readString(env.TAURUSDB_CLOUD_ACCESS_KEY_ID),
    readString(env.TAURUSDB_CLOUD_AK),
  );
  const cloudSecretAccessKey = pickFirstDefined(
    readString(env.TAURUSDB_CLOUD_SECRET_ACCESS_KEY),
    readString(env.TAURUSDB_CLOUD_SK),
  );
  const cloudSecurityToken = pickFirstDefined(
    readString(env.TAURUSDB_CLOUD_SECURITY_TOKEN),
    readString(env.TAURUSDB_CLOUD_SESSION_TOKEN),
  );
  const inferredDatasourceName = hasSqlTemplateInputs(env)
    ? readString(env.TAURUSDB_SQL_DATASOURCE) ?? "taurus_mcp"
    : undefined;

  return {
    defaultDatasource:
      readString(env.TAURUSDB_DEFAULT_DATASOURCE) ?? inferredDatasourceName,
    profilesPath: expandTildePath(readString(env.TAURUSDB_SQL_PROFILES)),
    cloud: {
      provider: "huaweicloud",
      region: cloudRegion,
      projectId: cloudProjectId,
      instanceId: cloudInstanceId,
      nodeId: cloudNodeId,
      authToken: cloudAuthToken,
      accessKeyId: cloudAccessKeyId,
      secretAccessKey: cloudSecretAccessKey,
      securityToken: cloudSecurityToken,
      keychainService: readString(env.TAURUSDB_CLOUD_KEYCHAIN_SERVICE),
      keychainAccount: readString(env.TAURUSDB_CLOUD_KEYCHAIN_ACCOUNT),
      apiEndpoint: buildHuaweiCloudEndpoint(
        "gaussdb",
        cloudRegion,
        cloudDomainSuffix,
      ),
      iamEndpoint: buildHuaweiCloudEndpoint(
        "iam",
        cloudRegion,
        cloudDomainSuffix,
      ),
      kmsEndpoint:
        readString(env.TAURUSDB_CLOUD_KMS_ENDPOINT) ??
        buildHuaweiCloudEndpoint("kms", cloudRegion, cloudDomainSuffix),
      csmsEndpoint:
        readString(env.TAURUSDB_CLOUD_CSMS_ENDPOINT) ??
        buildHuaweiCloudEndpoint("csms", cloudRegion, cloudDomainSuffix),
      domainSuffix: cloudDomainSuffix,
      language:
        readString(env.TAURUSDB_CLOUD_LANGUAGE) ??
        readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_LANGUAGE),
    },
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
      maxResultBytes: parseInteger(
        env.TAURUSDB_MCP_MAX_RESULT_BYTES,
        "TAURUSDB_MCP_MAX_RESULT_BYTES",
      ),
      maxBlobBytes: parseInteger(
        env.TAURUSDB_MCP_MAX_BLOB_BYTES,
        "TAURUSDB_MCP_MAX_BLOB_BYTES",
      ),
      maxConcurrentQueries: parseInteger(
        env.TAURUSDB_MCP_MAX_CONCURRENT_QUERIES,
        "TAURUSDB_MCP_MAX_CONCURRENT_QUERIES",
      ),
      maxQueuedQueries: parseInteger(
        env.TAURUSDB_MCP_MAX_QUEUED_QUERIES,
        "TAURUSDB_MCP_MAX_QUEUED_QUERIES",
      ),
      queueTimeoutMs: parseInteger(
        env.TAURUSDB_MCP_QUEUE_TIMEOUT_MS,
        "TAURUSDB_MCP_QUEUE_TIMEOUT_MS",
      ),
    },
    audit: {
      logPath: expandTildePath(readString(env.TAURUSDB_MCP_AUDIT_LOG_PATH)),
      includeRawSql: parseBoolean(
        env.TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL,
        "TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL",
      ),
      maxBytes: parseInteger(
        env.TAURUSDB_MCP_AUDIT_MAX_BYTES,
        "TAURUSDB_MCP_AUDIT_MAX_BYTES",
      ),
      maxFiles: parseInteger(
        env.TAURUSDB_MCP_AUDIT_MAX_FILES,
        "TAURUSDB_MCP_AUDIT_MAX_FILES",
      ),
    },
    security: {
      dynamicTargetsEnabled: parseBoolean(
        env.TAURUSDB_ENABLE_DYNAMIC_TARGETS,
        "TAURUSDB_ENABLE_DYNAMIC_TARGETS",
      ),
      recycleBinRestoreEnabled: parseBoolean(
        env.TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE,
        "TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE",
      ),
      requireTls: parseBoolean(
        env.TAURUSDB_REQUIRE_TLS,
        "TAURUSDB_REQUIRE_TLS",
      ),
      approvalSecretPath: expandTildePath(
        readString(env.TAURUSDB_MUTATION_APPROVAL_SECRET_FILE),
      ),
      approvalTtlSeconds: parseInteger(
        env.TAURUSDB_MUTATION_APPROVAL_TTL_SECONDS,
        "TAURUSDB_MUTATION_APPROVAL_TTL_SECONDS",
      ),
      credentialIdleTtlMinutes: parseInteger(
        env.TAURUSDB_SQL_CREDENTIAL_IDLE_TTL_MINUTES,
        "TAURUSDB_SQL_CREDENTIAL_IDLE_TTL_MINUTES",
      ),
      credentialMaxTtlMinutes: parseInteger(
        env.TAURUSDB_SQL_CREDENTIAL_MAX_TTL_MINUTES,
        "TAURUSDB_SQL_CREDENTIAL_MAX_TTL_MINUTES",
      ),
    },
    slowSqlSource: {
      taurusApi: {
        enabled: pickFirstDefined(
          parseBoolean(
            env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED,
            "TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED",
          ),
          cloudTaurusApiEnabled,
        ),
        endpoint: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENDPOINT),
          buildHuaweiCloudEndpoint("gaussdb", cloudRegion, cloudDomainSuffix),
        ),
        projectId: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_PROJECT_ID),
          cloudProjectId,
        ),
        instanceId: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_INSTANCE_ID),
          cloudInstanceId,
        ),
        nodeId: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_NODE_ID),
          cloudNodeId,
        ),
        authToken: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_AUTH_TOKEN),
          cloudAuthToken,
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
        enabled: pickFirstDefined(
          parseBoolean(
            env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED,
            "TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED",
          ),
          cloudDasEnabled,
          true,
        ),
        endpoint: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT),
          buildHuaweiCloudEndpoint("das", cloudRegion, cloudDomainSuffix),
        ),
        projectId: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_PROJECT_ID),
          cloudProjectId,
        ),
        instanceId: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_INSTANCE_ID),
          cloudInstanceId,
        ),
        authToken: pickFirstDefined(
          readString(env.TAURUSDB_SLOW_SQL_SOURCE_DAS_AUTH_TOKEN),
          cloudAuthToken,
        ),
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
        enabled: pickFirstDefined(
          parseBoolean(
            env.TAURUSDB_METRICS_SOURCE_CES_ENABLED,
            "TAURUSDB_METRICS_SOURCE_CES_ENABLED",
          ),
          cloudCesEnabled,
          true,
        ),
        endpoint: pickFirstDefined(
          readString(env.TAURUSDB_METRICS_SOURCE_CES_ENDPOINT),
          buildHuaweiCloudEndpoint("ces", cloudRegion, cloudDomainSuffix),
        ),
        projectId: pickFirstDefined(
          readString(env.TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID),
          cloudProjectId,
        ),
        instanceId: pickFirstDefined(
          readString(env.TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID),
          cloudInstanceId,
        ),
        nodeId: pickFirstDefined(
          readString(env.TAURUSDB_METRICS_SOURCE_CES_NODE_ID),
          cloudNodeId,
        ),
        authToken: pickFirstDefined(
          readString(env.TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN),
          cloudAuthToken,
        ),
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
