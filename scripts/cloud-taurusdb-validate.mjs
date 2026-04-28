#!/usr/bin/env node

import {
  TaurusDBEngine,
  createCloudTaurusInstanceClient,
  createConfigFromEnv,
  fetchHuaweiCloud,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
} from "@huaweicloud/taurusdb-core";

const TRUE_PATTERN = /^(true|1|yes|on)$/i;

function isEnabled(name) {
  return TRUE_PATTERN.test(process.env[name] || "");
}

function optional(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function required(name) {
  const value = optional(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function safeJsonKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).join(",") || "<none>"
    : "<non-object>";
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function printCheck(title, ok, details) {
  const prefix = ok ? "[ok]" : "[fail]";
  console.log(`${prefix} ${title}`);
  if (details) {
    console.log(`  ${details}`);
  }
}

async function runCheck(title, fn) {
  try {
    const details = await fn();
    printCheck(title, true, details);
    return { ok: true, details };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printCheck(title, false, message);
    return { ok: false, details: message };
  }
}

function buildContextInput(datasource, database, readonly = true) {
  return {
    datasource,
    database,
    readonly,
  };
}

function pickValidationDatabase(datasources, explicitDatabase) {
  if (explicitDatabase) {
    return explicitDatabase;
  }
  const withDatabase = datasources.find((item) => item.database);
  return withDatabase?.database;
}

async function validateMcpDataPlane(config) {
  const engine = await TaurusDBEngine.create({ config });
  let failed = false;
  let defaultDatasource;
  let validationDatasource;
  let validationDatabase;
  let validationDataSourceInfo;

  try {
    const sourcesResult = await runCheck("MCP datasource profiles", async () => {
      const [items, defaultName] = await Promise.all([
        engine.listDataSources(),
        engine.getDefaultDataSource(),
      ]);
      if (items.length === 0) {
        throw new Error("No datasource profile is configured.");
      }
      defaultDatasource = defaultName;
      validationDatasource =
        optional("TAURUSDB_CLOUD_VALIDATE_DATASOURCE") ??
        defaultName ??
        items[0]?.name;
      validationDataSourceInfo = items.find((item) => item.name === validationDatasource);
      validationDatabase = pickValidationDatabase(
        items,
        optional("TAURUSDB_CLOUD_VALIDATE_DATABASE"),
      );
      return `count=${items.length} default=${defaultName ?? "<none>"} selected=${validationDatasource}`;
    });
    failed ||= !sourcesResult.ok;

    if (!validationDatasource) {
      return { failed: true, datasource: undefined, database: validationDatabase, defaultDatasource };
    }

    const ctxResult = await runCheck("MCP readonly context", async () => {
      const ctx = await engine.resolveContext(
        buildContextInput(validationDatasource, validationDatabase, true),
        "task_cloud_validate_context",
      );
      validationDatabase = validationDatabase ?? ctx.database;
      return `datasource=${ctx.datasource} database=${ctx.database ?? "<none>"}`;
    });
    failed ||= !ctxResult.ok;
    if (!ctxResult.ok) {
      return { failed: true, datasource: validationDatasource, database: validationDatabase, defaultDatasource };
    }

    const ctx = await engine.resolveContext(
      buildContextInput(validationDatasource, validationDatabase, true),
      "task_cloud_validate",
    );

    const pingResult = await runCheck("MCP readonly SQL", async () => {
      const result = await engine.executeReadonly("SELECT 1 AS taurusdb_mcp_ping", ctx, {
        maxRows: 5,
        maxColumns: 5,
        timeoutMs: 5000,
      });
      return `rows=${result.rowCount} duration_ms=${result.durationMs}`;
    });
    failed ||= !pingResult.ok;

    const databasesResult = await runCheck("MCP list databases", async () => {
      const items = await engine.listDatabases(ctx);
      return `count=${items.length}`;
    });
    failed ||= !databasesResult.ok;

    if (validationDatabase) {
      const tablesResult = await runCheck("MCP list tables", async () => {
        const items = await engine.listTables(ctx, validationDatabase);
        return `database=${validationDatabase} count=${items.length}`;
      });
      failed ||= !tablesResult.ok;

      const table = optional("TAURUSDB_CLOUD_VALIDATE_TABLE");
      if (table) {
        const describeResult = await runCheck("MCP describe table", async () => {
          const schema = await engine.describeTable(ctx, validationDatabase, table);
          return `table=${schema.table} columns=${schema.columns.length} indexes=${schema.indexes.length}`;
        });
        failed ||= !describeResult.ok;
      }
    }

    const explainSql = optional("TAURUSDB_CLOUD_VALIDATE_EXPLAIN_SQL", "SELECT 1");
    const explainResult = await runCheck("MCP explain SQL", async () => {
      const result = await engine.explain(explainSql, ctx);
      return `plan_rows=${result.plan.length} duration_ms=${result.durationMs}`;
    });
    failed ||= !explainResult.ok;

    const capabilityResult = await runCheck("TaurusDB capability probe", async () => {
      const snapshot = await engine.probeCapabilities(ctx);
      const featureSummary = Object.entries(snapshot.features)
        .map(([name, feature]) => `${name}:${feature.available ? "yes" : "no"}`)
        .join(",");
      return `is_taurusdb=${snapshot.kernelInfo.isTaurusDB} version=${snapshot.kernelInfo.version ?? "<unknown>"} features=${featureSummary}`;
    });
    failed ||= !capabilityResult.ok;

    if (isEnabled("TAURUSDB_CLOUD_VALIDATE_DIAGNOSTICS")) {
      const topSlowResult = await runCheck("Diagnostics find_top_slow_sql", async () => {
        const result = await engine.findTopSlowSql(
          {
            datasource: validationDatasource,
            database: validationDatabase,
            timeRange: { relative: optional("TAURUSDB_CLOUD_VALIDATE_TIME_RANGE", "30m") },
            topN: Number(optional("TAURUSDB_CLOUD_VALIDATE_TOP_N", "5")),
            sortBy: "total_latency",
            evidenceLevel: "standard",
          },
          ctx,
        );
        return `status=${result.status} top_sqls=${result.topSqls.length} evidence=${result.evidence.map((item) => item.source).join(",") || "<none>"}`;
      });
      failed ||= !topSlowResult.ok;

      const latencyResult = await runCheck("Diagnostics service latency", async () => {
        const result = await engine.diagnoseServiceLatency(
          {
            datasource: validationDatasource,
            database: validationDatabase,
            symptom: "latency",
            timeRange: { relative: optional("TAURUSDB_CLOUD_VALIDATE_TIME_RANGE", "30m") },
            evidenceLevel: "standard",
          },
          ctx,
        );
        return `status=${result.status} candidates=${result.topCandidates.length} evidence=${result.evidence.map((item) => item.source).join(",") || "<none>"}`;
      });
      failed ||= !latencyResult.ok;
    } else {
      printCheck(
        "Diagnostics validation",
        true,
        "skipped; set TAURUSDB_CLOUD_VALIDATE_DIAGNOSTICS=true to run read-only diagnostic checks",
      );
    }

    return {
      failed,
      datasource: validationDatasource,
      database: validationDatabase,
      defaultDatasource,
      dataSourceInfo: validationDataSourceInfo,
    };
  } finally {
    await engine.close();
  }
}

function assignResolvedInstanceId(config, instanceId) {
  config.cloud.instanceId = config.cloud.instanceId ?? instanceId;
  if (config.slowSqlSource?.taurusApi) {
    config.slowSqlSource.taurusApi.instanceId =
      config.slowSqlSource.taurusApi.instanceId ?? instanceId;
  }
  if (config.slowSqlSource?.das) {
    config.slowSqlSource.das.instanceId =
      config.slowSqlSource.das.instanceId ?? instanceId;
  }
  if (config.metricsSource?.ces) {
    config.metricsSource.ces.instanceId =
      config.metricsSource.ces.instanceId ?? instanceId;
  }
}

function assignResolvedProjectId(config, projectId) {
  config.cloud.projectId = config.cloud.projectId ?? projectId;
  if (config.slowSqlSource?.taurusApi) {
    config.slowSqlSource.taurusApi.projectId =
      config.slowSqlSource.taurusApi.projectId ?? projectId;
  }
  if (config.slowSqlSource?.das) {
    config.slowSqlSource.das.projectId =
      config.slowSqlSource.das.projectId ?? projectId;
  }
  if (config.metricsSource?.ces) {
    config.metricsSource.ces.projectId =
      config.metricsSource.ces.projectId ?? projectId;
  }
}

function assignResolvedNodeId(config, nodeId) {
  config.cloud.nodeId = config.cloud.nodeId ?? nodeId;
  if (config.slowSqlSource?.taurusApi) {
    config.slowSqlSource.taurusApi.nodeId =
      config.slowSqlSource.taurusApi.nodeId ?? nodeId;
  }
  if (config.metricsSource?.ces) {
    config.metricsSource.ces.nodeId =
      config.metricsSource.ces.nodeId ?? nodeId;
  }
}

async function resolveCloudInstance(config, dataSourceInfo) {
  const resolvedProjectId = await resolveHuaweiCloudProjectId(
    getHuaweiCloudAuthFromConfig(config),
  );
  if (resolvedProjectId) {
    assignResolvedProjectId(config, resolvedProjectId);
  }

  const explicitInstanceId =
    config.cloud?.instanceId ??
    config.slowSqlSource?.taurusApi?.instanceId ??
    config.slowSqlSource?.das?.instanceId ??
    config.metricsSource?.ces?.instanceId;

  if (explicitInstanceId) {
    assignResolvedInstanceId(config, explicitInstanceId);
    return { instanceId: explicitInstanceId, instanceName: undefined, resolvedBy: "explicit_instance_id" };
  }

  const anyCloudEvidenceEnabled =
    Boolean(config.slowSqlSource?.taurusApi?.enabled) ||
    Boolean(config.slowSqlSource?.das?.enabled) ||
    Boolean(config.metricsSource?.ces?.enabled);
  if (!anyCloudEvidenceEnabled) {
    return { instanceId: undefined, instanceName: undefined, resolvedBy: "not_required" };
  }

  if (!dataSourceInfo?.host) {
    throw new Error(
      "Cloud evidence is enabled, but the selected datasource does not expose a host for instance auto-resolution.",
    );
  }

  const client = createCloudTaurusInstanceClient(config);
  if (!client) {
    throw new Error(
      "Cloud instance resolver is not configured. Provide TAURUSDB_CLOUD_REGION, TAURUSDB_CLOUD_PROJECT_ID, and TAURUSDB_CLOUD_AUTH_TOKEN.",
    );
  }

  const instance = await client.resolveByHostPort(
    dataSourceInfo.host,
    dataSourceInfo.port,
  );
  const projectId = await client.getProjectId();
  assignResolvedProjectId(config, projectId);
  assignResolvedInstanceId(config, instance.id);
  if (instance.primaryNodeId) {
    assignResolvedNodeId(config, instance.primaryNodeId);
  }
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    nodeId: instance.primaryNodeId,
    resolvedBy: "datasource_host_port",
  };
}

async function validateDas(config) {
  const das = config.slowSqlSource?.das;
  if (!das?.enabled) {
    printCheck("DAS validation", true, "skipped; DAS source is not enabled in resolved config");
    return false;
  }
  const hasCloudAksk =
    Boolean(config.cloud?.accessKeyId && config.cloud?.secretAccessKey);
  if (!das.endpoint || !das.projectId || !das.instanceId || (!das.authToken && !hasCloudAksk)) {
    printCheck(
      "DAS validation",
      false,
      "resolved DAS config is incomplete; need endpoint, projectId, instanceId, and authToken",
    );
    return true;
  }

  const endpoint = das.endpoint.replace(/\/+$/g, "");
  const projectId = das.projectId;
  const instanceId = das.instanceId;
  const datastoreType = das.datastoreType;

  let failed = false;

  const switchResult = await runCheck("DAS sql/switch", async () => {
    const response = await fetchHuaweiCloud({
      url: `${endpoint}/v3/${projectId}/instances/${instanceId}/sql/switch`,
      headers: {
        "content-type": "application/json",
      },
      auth: {
        ...getHuaweiCloudAuthFromConfig(config),
        authToken: das.authToken ?? config.cloud?.authToken,
        projectId,
      },
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(`status=${response.status} keys=${safeJsonKeys(body)}`);
    }
    return `status=${response.status} keys=${safeJsonKeys(body)}`;
  });
  failed ||= !switchResult.ok;

  const topSlowResult = await runCheck("DAS top-slow-log", async () => {
    const response = await fetchHuaweiCloud({
      url: `${endpoint}/v3/${projectId}/instances/${instanceId}/top-slow-log?datastore_type=${encodeURIComponent(datastoreType)}&num=1`,
      headers: {
        "content-type": "application/json",
      },
      auth: {
        ...getHuaweiCloudAuthFromConfig(config),
        authToken: das.authToken ?? config.cloud?.authToken,
        projectId,
      },
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(`status=${response.status} keys=${safeJsonKeys(body)}`);
    }
    return `status=${response.status} keys=${safeJsonKeys(body)}`;
  });
  failed ||= !topSlowResult.ok;

  return failed;
}

async function validateCes(config) {
  const ces = config.metricsSource?.ces;
  if (!ces?.enabled) {
    printCheck("CES validation", true, "skipped; CES source is not enabled in resolved config");
    return false;
  }
  const hasCloudAksk =
    Boolean(config.cloud?.accessKeyId && config.cloud?.secretAccessKey);
  if (!ces.endpoint || !ces.projectId || !ces.instanceId || (!ces.authToken && !hasCloudAksk)) {
    printCheck(
      "CES validation",
      false,
      "resolved CES config is incomplete; need endpoint, projectId, instanceId, and authToken",
    );
    return true;
  }

  const endpoint = ces.endpoint.replace(/\/+$/g, "");
  const projectId = ces.projectId;
  const instanceId = ces.instanceId;
  const nodeId = ces.nodeId ?? "";
  const namespace = ces.namespace;
  const instanceDimension = ces.instanceDimension;
  const nodeDimension = ces.nodeDimension;
  const period = ces.period;
  const now = Date.now();
  const body = {
    namespace,
    metric_name: ["gaussdb_mysql001_cpu_util", "gaussdb_mysql048_disk_used_size"],
    from: now - 60 * 60 * 1000,
    to: now,
    period,
    filter: ces.filter,
    dimensions: [
      { name: instanceDimension, value: instanceId },
      ...(nodeId ? [{ name: nodeDimension, value: nodeId }] : []),
    ],
  };

  const result = await runCheck("CES batch-query-metric-data", async () => {
    const response = await fetchHuaweiCloud({
      url: `${endpoint}/V1.0/${projectId}/batch-query-metric-data`,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      auth: {
        ...getHuaweiCloudAuthFromConfig(config),
        authToken: ces.authToken ?? config.cloud?.authToken,
        projectId,
      },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`status=${response.status} keys=${safeJsonKeys(payload)}`);
    }
    return `status=${response.status} keys=${safeJsonKeys(payload)}`;
  });

  return !result.ok;
}

async function main() {
  let failed = false;
  const config = createConfigFromEnv(process.env);

  console.log("TaurusDB MCP cloud validation");
  console.log("--------------------------------");

  const dataPlane = await validateMcpDataPlane(config);
  failed ||= dataPlane.failed;
  const instanceResolution = await runCheck("Cloud instance resolution", async () => {
    const resolved = await resolveCloudInstance(config, dataPlane.dataSourceInfo);
    if (!resolved.instanceId) {
      return `skipped; ${resolved.resolvedBy}`;
    }
    return `instance_id=${resolved.instanceId} instance_name=${resolved.instanceName ?? "<unknown>"} source=${resolved.resolvedBy}`;
  });
  failed ||= !instanceResolution.ok;
  failed ||= await validateDas(config);
  failed ||= await validateCes(config);

  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error("[fatal]", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
