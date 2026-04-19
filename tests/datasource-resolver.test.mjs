import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "../dist/config/index.js";
import {
  createDatasourceResolver,
  DatasourceResolutionError,
} from "../dist/context/datasource-resolver.js";

function makeProfile({
  name = "local_mysql",
  engine = "mysql",
  database = "demo",
} = {}) {
  return {
    name,
    engine,
    host: "127.0.0.1",
    port: 3306,
    database,
    readonlyUser: { username: "ro", password: { type: "plain", value: "ro_pwd" } },
    mutationUser: { username: "rw", password: { type: "plain", value: "rw_pwd" } },
    toString() {
      return JSON.stringify({ name, engine, database });
    },
  };
}

function makeProfileLoader(profilesMap, defaultDatasource) {
  return {
    async load() {
      return new Map(profilesMap);
    },
    async getDefault() {
      return defaultDatasource;
    },
    async get(name) {
      return profilesMap.get(name);
    },
  };
}

test("datasource resolver uses explicit datasource and per-call overrides", async () => {
  const pA = makeProfile({ name: "a", engine: "mysql", database: "db_a" });
  const pB = makeProfile({ name: "b", engine: "postgresql", database: "db_b" });
  const profiles = new Map([
    [pA.name, pA],
    [pB.name, pB],
  ]);

  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({
      TAURUSDB_DEFAULT_DATASOURCE: "a",
      TAURUSDB_MCP_MAX_ROWS: "222",
      TAURUSDB_MCP_MAX_COLUMNS: "44",
      TAURUSDB_MCP_MAX_STATEMENT_MS: "5000",
    }),
    profileLoader: makeProfileLoader(profiles, "a"),
  });

  const context = await resolver.resolve(
    {
      datasource: "b",
      database: "override_db",
      schema: "public",
      timeout_ms: 2000,
      readonly: false,
    },
    "task_001",
  );

  assert.equal(context.task_id, "task_001");
  assert.equal(context.datasource, "b");
  assert.equal(context.engine, "postgresql");
  assert.equal(context.database, "override_db");
  assert.equal(context.schema, "public");
  assert.equal(context.limits.readonly, false);
  assert.equal(context.limits.timeoutMs, 2000);
  assert.equal(context.limits.maxRows, 222);
  assert.equal(context.limits.maxColumns, 44);
  assert.equal(context.limits.maxFieldChars, 2048);
});

test("datasource resolver falls back to config.defaultDatasource", async () => {
  const profile = makeProfile({ name: "default_ds", database: "default_db" });
  const profiles = new Map([[profile.name, profile]]);

  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({
      TAURUSDB_DEFAULT_DATASOURCE: "default_ds",
      TAURUSDB_MCP_MAX_STATEMENT_MS: "4000",
    }),
    profileLoader: makeProfileLoader(profiles, undefined),
  });

  const context = await resolver.resolve({}, "task_002");
  assert.equal(context.datasource, "default_ds");
  assert.equal(context.database, "default_db");
  assert.equal(context.limits.readonly, true);
  assert.equal(context.limits.timeoutMs, 4000);
  assert.equal(context.limits.maxFieldChars, 2048);
});

test("datasource resolver falls back to profileLoader.getDefault", async () => {
  const profile = makeProfile({ name: "from_loader", database: "loader_db" });
  const profiles = new Map([[profile.name, profile]]);

  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles, "from_loader"),
  });

  const context = await resolver.resolve({}, "task_003");
  assert.equal(context.datasource, "from_loader");
  assert.equal(context.database, "loader_db");
});

test("datasource resolver caps timeout_ms by config max", async () => {
  const profile = makeProfile({ name: "ds" });
  const profiles = new Map([[profile.name, profile]]);

  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({
      TAURUSDB_DEFAULT_DATASOURCE: "ds",
      TAURUSDB_MCP_MAX_STATEMENT_MS: "3000",
    }),
    profileLoader: makeProfileLoader(profiles, undefined),
  });

  const context = await resolver.resolve({ timeout_ms: 15000 }, "task_004");
  assert.equal(context.limits.timeoutMs, 3000);
  assert.equal(context.limits.maxFieldChars, 2048);
});

test("datasource resolver throws when no datasource can be determined", async () => {
  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(new Map(), undefined),
  });

  await assert.rejects(async () => resolver.resolve({}, "task_005"), (error) => {
    assert.ok(error instanceof DatasourceResolutionError);
    assert.equal(error.code, "DATASOURCE_NOT_FOUND");
    return true;
  });
});

test("datasource resolver throws when datasource profile does not exist", async () => {
  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({ TAURUSDB_DEFAULT_DATASOURCE: "missing_ds" }),
    profileLoader: makeProfileLoader(new Map(), undefined),
  });

  await assert.rejects(async () => resolver.resolve({}, "task_006"), /Datasource profile "missing_ds" was not found/);
});

test("datasource resolver throws on invalid timeout_ms", async () => {
  const profile = makeProfile({ name: "ds" });
  const profiles = new Map([[profile.name, profile]]);

  const resolver = createDatasourceResolver({
    config: createConfigFromEnv({ TAURUSDB_DEFAULT_DATASOURCE: "ds" }),
    profileLoader: makeProfileLoader(profiles, undefined),
  });

  await assert.rejects(async () => resolver.resolve({ timeout_ms: 0 }, "task_007"), (error) => {
    assert.ok(error instanceof DatasourceResolutionError);
    assert.equal(error.code, "INVALID_CONTEXT_INPUT");
    return true;
  });
});
