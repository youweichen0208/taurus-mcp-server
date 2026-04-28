#!/usr/bin/env node

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const optional = (name, fallback) => process.env[name]?.trim() || fallback;

const readJson = async (response) => {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const printCheck = (title, ok, details) => {
  const prefix = ok ? "[ok]" : "[fail]";
  console.log(`${prefix} ${title}`);
  if (details) {
    console.log(`  ${details}`);
  }
};

const dasEnabled = /^true|1|yes|on$/i.test(
  process.env.TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED || "",
);
const cesEnabled = /^true|1|yes|on$/i.test(
  process.env.TAURUSDB_METRICS_SOURCE_CES_ENABLED || "",
);

async function checkDas() {
  const endpoint = required("TAURUSDB_SLOW_SQL_SOURCE_DAS_ENDPOINT").replace(
    /\/+$/g,
    "",
  );
  const projectId = required("TAURUSDB_SLOW_SQL_SOURCE_DAS_PROJECT_ID");
  const instanceId = required("TAURUSDB_SLOW_SQL_SOURCE_DAS_INSTANCE_ID");
  const authToken = required("TAURUSDB_SLOW_SQL_SOURCE_DAS_AUTH_TOKEN");
  const datastoreType = optional(
    "TAURUSDB_SLOW_SQL_SOURCE_DAS_DATASTORE_TYPE",
    "TaurusDB",
  );

  const switchResponse = await fetch(
    `${endpoint}/v3/${projectId}/instances/${instanceId}/sql/switch`,
    {
      headers: {
        "content-type": "application/json",
        "x-auth-token": authToken,
      },
    },
  );
  const switchBody = await readJson(switchResponse);
  printCheck(
    "DAS sql/switch",
    switchResponse.ok,
    `status=${switchResponse.status} keys=${Object.keys(switchBody).join(",")}`,
  );

  const topSlowResponse = await fetch(
    `${endpoint}/v3/${projectId}/instances/${instanceId}/top-slow-log?datastore_type=${encodeURIComponent(
      datastoreType,
    )}&num=1`,
    {
      headers: {
        "content-type": "application/json",
        "x-auth-token": authToken,
      },
    },
  );
  const topSlowBody = await readJson(topSlowResponse);
  printCheck(
    "DAS top-slow-log",
    topSlowResponse.ok,
    `status=${topSlowResponse.status} keys=${Object.keys(topSlowBody).join(",")}`,
  );
}

async function checkCes() {
  const endpoint = required("TAURUSDB_METRICS_SOURCE_CES_ENDPOINT").replace(
    /\/+$/g,
    "",
  );
  const projectId = required("TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID");
  const instanceId = required("TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID");
  const nodeId = optional("TAURUSDB_METRICS_SOURCE_CES_NODE_ID", "");
  const authToken = required("TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN");
  const namespace = optional(
    "TAURUSDB_METRICS_SOURCE_CES_NAMESPACE",
    "SYS.GAUSSDB",
  );
  const instanceDimension = optional(
    "TAURUSDB_METRICS_SOURCE_CES_INSTANCE_DIMENSION",
    "gaussdb_mysql_instance_id",
  );
  const nodeDimension = optional(
    "TAURUSDB_METRICS_SOURCE_CES_NODE_DIMENSION",
    "gaussdb_mysql_node_id",
  );
  const period = optional("TAURUSDB_METRICS_SOURCE_CES_PERIOD", "60");
  const now = Date.now();

  const body = {
    namespace,
    metric_name: ["gaussdb_mysql001_cpu_util", "gaussdb_mysql048_disk_used_size"],
    from: now - 60 * 60 * 1000,
    to: now,
    period,
    filter: "average",
    dimensions: [
      { name: instanceDimension, value: instanceId },
      ...(nodeId ? [{ name: nodeDimension, value: nodeId }] : []),
    ],
  };

  const response = await fetch(
    `${endpoint}/V1.0/${projectId}/batch-query-metric-data`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-auth-token": authToken,
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await readJson(response);
  printCheck(
    "CES batch-query-metric-data",
    response.ok,
    `status=${response.status} keys=${Object.keys(payload).join(",")}`,
  );
}

async function main() {
  try {
    if (!dasEnabled && !cesEnabled) {
      throw new Error(
        "Enable at least one source: TAURUSDB_SLOW_SQL_SOURCE_DAS_ENABLED=true or TAURUSDB_METRICS_SOURCE_CES_ENABLED=true",
      );
    }

    if (dasEnabled) {
      await checkDas();
    }
    if (cesEnabled) {
      await checkCes();
    }
  } catch (error) {
    console.error("[fatal]", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
