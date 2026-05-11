#!/usr/bin/env node

import {
  createConfigFromEnv,
  fetchHuaweiCloud,
  resolveHuaweiCloudProjectId,
} from "@huaweicloud/taurusdb-core";

const config = createConfigFromEnv(process.env);
const projectId = await resolveHuaweiCloudProjectId(config.cloud);
const ces = config.metricsSource?.ces;

if (!ces?.endpoint) {
  throw new Error("CES endpoint is missing.");
}

if (!projectId) {
  throw new Error("Unable to resolve project id.");
}

const instanceId =
  ces.instanceId ?? process.env.TAURUSDB_CLOUD_INSTANCE_ID;
const nodeId = ces.nodeId ?? process.env.TAURUSDB_CLOUD_NODE_ID;

if (!instanceId || !nodeId) {
  throw new Error("CES instanceId/nodeId is missing.");
}

const dimensions = [
  { name: ces.instanceDimension, value: instanceId },
  { name: ces.nodeDimension, value: nodeId },
];

const body = {
  metrics: [
    {
      namespace: ces.namespace,
      metric_name: "gaussdb_mysql001_cpu_util",
      dimensions,
    },
    {
      namespace: ces.namespace,
      metric_name: "gaussdb_mysql048_disk_used_size",
      dimensions,
    },
  ],
  from: Date.now() - 60 * 60 * 1000,
  to: Date.now(),
  period: ces.period,
  filter: ces.filter,
};

const response = await fetchHuaweiCloud({
  url: `${ces.endpoint.replace(/\/+$/g, "")}/V1.0/${projectId}/batch-query-metric-data`,
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
  auth: {
    ...config.cloud,
    projectId,
  },
});

const text = await response.text();

console.log(`STATUS ${response.status}`);
console.log(text);
