import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { createConfigFromEnv, redactConfigForLog } from "../dist/config/index.js";

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
    token: "abc",
    nested: { password: "p1", api_key: "k1", keep: "x" },
  });

  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.nested.password, "[REDACTED]");
  assert.equal(redacted.nested.api_key, "[REDACTED]");
  assert.equal(redacted.nested.keep, "x");
});
