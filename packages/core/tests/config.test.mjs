import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  createConfigFromEnv,
  redactConfigForLog,
} from "../dist/config/index.js";

test("config uses documented defaults when env is empty", () => {
  const config = createConfigFromEnv({});

  assert.equal(config.defaultDatasource, undefined);
  assert.equal(config.profilesPath, undefined);
  assert.equal(config.enableMutations, false);
  assert.equal(config.limits.maxRows, 200);
  assert.equal(config.limits.maxColumns, 50);
  assert.equal(config.limits.maxStatementMs, 15000);
  assert.equal(config.limits.maxFieldChars, 2048);
  assert.equal(config.audit.includeRawSql, false);
  assert.equal(config.audit.logPath, "~/.taurusdb-mcp/audit.jsonl");
  assert.equal(config.slowSqlSource.taurusApi.enabled, false);
  assert.equal(config.slowSqlSource.taurusApi.requestTimeoutMs, 5000);
  assert.equal(config.slowSqlSource.taurusApi.defaultLookbackMinutes, 60);
  assert.equal(config.slowSqlSource.taurusApi.maxRecords, 20);
  assert.equal(config.metricsSource.ces.enabled, false);
  assert.equal(config.metricsSource.ces.namespace, "SYS.GAUSSDB");
  assert.equal(
    config.metricsSource.ces.instanceDimension,
    "gaussdb_mysql_instance_id",
  );
  assert.equal(config.metricsSource.ces.nodeDimension, "gaussdb_mysql_node_id");
  assert.equal(config.metricsSource.ces.period, "60");
  assert.equal(config.metricsSource.ces.filter, "average");
  assert.equal(config.metricsSource.ces.requestTimeoutMs, 5000);
  assert.equal(config.metricsSource.ces.defaultLookbackMinutes, 60);
});

test("config maps env vars into typed fields", () => {
  const config = createConfigFromEnv({
    TAURUSDB_DEFAULT_DATASOURCE: "local_mysql",
    TAURUSDB_SQL_PROFILES: "~/profiles.json",
    TAURUSDB_MCP_ENABLE_MUTATIONS: "true",
    TAURUSDB_MCP_MAX_ROWS: "123",
    TAURUSDB_MCP_MAX_COLUMNS: "12",
    TAURUSDB_MCP_MAX_STATEMENT_MS: "3000",
    TAURUSDB_MCP_MAX_FIELD_CHARS: "999",
    TAURUSDB_MCP_AUDIT_LOG_PATH: "~/audit.jsonl",
    TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL: "1",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENABLED: "true",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_ENDPOINT:
      "https://gaussdb.cn-north-4.myhuaweicloud.com",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_PROJECT_ID: "project-1",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_INSTANCE_ID: "instance-1",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_NODE_ID: "node-1",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_AUTH_TOKEN: "token-1",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_LANGUAGE: "en-us",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_TIMEOUT_MS: "9000",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_DEFAULT_LOOKBACK_MINUTES: "180",
    TAURUSDB_SLOW_SQL_SOURCE_TAURUS_API_MAX_RECORDS: "40",
    TAURUSDB_METRICS_SOURCE_CES_ENABLED: "true",
    TAURUSDB_METRICS_SOURCE_CES_ENDPOINT:
      "https://ces.cn-north-4.myhuaweicloud.com",
    TAURUSDB_METRICS_SOURCE_CES_PROJECT_ID: "project-1",
    TAURUSDB_METRICS_SOURCE_CES_INSTANCE_ID: "instance-1",
    TAURUSDB_METRICS_SOURCE_CES_NODE_ID: "node-1",
    TAURUSDB_METRICS_SOURCE_CES_AUTH_TOKEN: "token-2",
    TAURUSDB_METRICS_SOURCE_CES_NAMESPACE: "SYS.GAUSSDB",
    TAURUSDB_METRICS_SOURCE_CES_INSTANCE_DIMENSION: "gaussdb_mysql_instance_id",
    TAURUSDB_METRICS_SOURCE_CES_NODE_DIMENSION: "gaussdb_mysql_node_id",
    TAURUSDB_METRICS_SOURCE_CES_PERIOD: "300",
    TAURUSDB_METRICS_SOURCE_CES_FILTER: "max",
    TAURUSDB_METRICS_SOURCE_CES_TIMEOUT_MS: "8000",
    TAURUSDB_METRICS_SOURCE_CES_DEFAULT_LOOKBACK_MINUTES: "120",
  });

  assert.equal(config.defaultDatasource, "local_mysql");
  assert.equal(config.profilesPath, `${os.homedir()}/profiles.json`);
  assert.equal(config.enableMutations, true);
  assert.equal(config.limits.maxRows, 123);
  assert.equal(config.limits.maxColumns, 12);
  assert.equal(config.limits.maxStatementMs, 3000);
  assert.equal(config.limits.maxFieldChars, 999);
  assert.equal(config.audit.logPath, `${os.homedir()}/audit.jsonl`);
  assert.equal(config.audit.includeRawSql, true);
  assert.equal(config.slowSqlSource.taurusApi.enabled, true);
  assert.equal(
    config.slowSqlSource.taurusApi.endpoint,
    "https://gaussdb.cn-north-4.myhuaweicloud.com",
  );
  assert.equal(config.slowSqlSource.taurusApi.projectId, "project-1");
  assert.equal(config.slowSqlSource.taurusApi.instanceId, "instance-1");
  assert.equal(config.slowSqlSource.taurusApi.nodeId, "node-1");
  assert.equal(config.slowSqlSource.taurusApi.authToken, "token-1");
  assert.equal(config.slowSqlSource.taurusApi.language, "en-us");
  assert.equal(config.slowSqlSource.taurusApi.requestTimeoutMs, 9000);
  assert.equal(config.slowSqlSource.taurusApi.defaultLookbackMinutes, 180);
  assert.equal(config.slowSqlSource.taurusApi.maxRecords, 40);
  assert.equal(config.metricsSource.ces.enabled, true);
  assert.equal(
    config.metricsSource.ces.endpoint,
    "https://ces.cn-north-4.myhuaweicloud.com",
  );
  assert.equal(config.metricsSource.ces.projectId, "project-1");
  assert.equal(config.metricsSource.ces.instanceId, "instance-1");
  assert.equal(config.metricsSource.ces.nodeId, "node-1");
  assert.equal(config.metricsSource.ces.authToken, "token-2");
  assert.equal(config.metricsSource.ces.namespace, "SYS.GAUSSDB");
  assert.equal(
    config.metricsSource.ces.instanceDimension,
    "gaussdb_mysql_instance_id",
  );
  assert.equal(config.metricsSource.ces.nodeDimension, "gaussdb_mysql_node_id");
  assert.equal(config.metricsSource.ces.period, "300");
  assert.equal(config.metricsSource.ces.filter, "max");
  assert.equal(config.metricsSource.ces.requestTimeoutMs, 8000);
  assert.equal(config.metricsSource.ces.defaultLookbackMinutes, 120);
});

test("config throws on invalid boolean env values", () => {
  assert.throws(
    () =>
      createConfigFromEnv({
        TAURUSDB_MCP_ENABLE_MUTATIONS: "sometimes",
      }),
    /Invalid boolean for TAURUSDB_MCP_ENABLE_MUTATIONS/,
  );
});

test("config throws when integer env value is invalid", () => {
  assert.throws(
    () =>
      createConfigFromEnv({
        TAURUSDB_MCP_MAX_ROWS: "12.3",
      }),
    /Invalid configuration|Invalid integer/,
  );
});

test("redactConfigForLog redacts sensitive keys recursively", () => {
  const redacted = redactConfigForLog({
    defaultDatasource: "a",
    profilesPath: "/tmp/profiles.json",
    enableMutations: false,
    limits: { maxRows: 1, maxColumns: 1, maxStatementMs: 1, maxFieldChars: 1 },
    audit: { logPath: "/tmp/audit.jsonl", includeRawSql: false },
    slowSqlSource: {
      taurusApi: {
        enabled: true,
        endpoint: "https://example.com",
        authToken: "token_123",
        requestTimeoutMs: 5000,
        defaultLookbackMinutes: 60,
        maxRecords: 20,
      },
    },
    metricsSource: {
      ces: {
        enabled: true,
        endpoint: "https://example.com",
        projectId: "project",
        instanceId: "instance",
        authToken: "token_456",
        namespace: "SYS.GAUSSDB",
        instanceDimension: "gaussdb_mysql_instance_id",
        nodeDimension: "gaussdb_mysql_node_id",
        period: "60",
        filter: "average",
        requestTimeoutMs: 5000,
        defaultLookbackMinutes: 60,
      },
    },
    token: "abc",
    nested: { password: "p1", api_key: "k1", keep: "x" },
  });

  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.metricsSource.ces.authToken, "[REDACTED]");
  assert.equal(redacted.slowSqlSource.taurusApi.authToken, "[REDACTED]");
  assert.equal(redacted.nested.password, "[REDACTED]");
  assert.equal(redacted.nested.api_key, "[REDACTED]");
  assert.equal(redacted.nested.keep, "x");
});
