import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfigFromEnv } from "../dist/config/index.js";
import {
  RuntimeOverrideProfileLoader,
  SqlProfileLoader,
} from "../dist/auth/sql-profile-loader.js";

async function createTempProfilesFile(contentObject) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurus-profiles-"));
  const filePath = path.join(tempDir, "profiles.json");
  await writeFile(filePath, `${JSON.stringify(contentObject, null, 2)}\n`, "utf-8");
  return filePath;
}

function makeConfig(overrides = {}) {
  return {
    ...createConfigFromEnv({}),
    ...overrides,
  };
}

test("profile loader reads profiles.json and default datasource", async () => {
  const profilesPath = await createTempProfilesFile({
    defaultDatasource: "prod_orders",
    dataSources: {
      prod_orders: {
        engine: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "orders",
        user: { username: "app", password: "env:APP_PWD" },
        poolSize: 8,
      },
      staging_analytics: {
        engine: "postgresql",
        host: "localhost",
        port: 5432,
        user: { username: "analytics_app", password: "file:/tmp/pwd.txt" },
      },
    },
  });

  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath }),
    env: {},
  });

  const profiles = await loader.load();
  assert.equal(profiles.size, 2);
  assert.equal(await loader.getDefault(), "prod_orders");

  const prod = profiles.get("prod_orders");
  assert.ok(prod);
  assert.equal(prod.engine, "mysql");
  assert.equal(prod.user.password.type, "env");
  assert.equal(prod.user.password.key, "APP_PWD");
});

test("profile loader uses env profile when file is absent", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
      TAURUSDB_SQL_PORT: "3306",
      TAURUSDB_SQL_USER: "root",
      TAURUSDB_SQL_PASSWORD: "env:MYSQL_ROOT_PASSWORD",
      TAURUSDB_SQL_DATABASE: "demo",
    },
  });

  const profiles = await loader.load();
  assert.equal(profiles.size, 1);

  const profile = profiles.get("taurus_mcp");
  assert.ok(profile);
  assert.equal(profile.engine, "mysql");
  assert.equal(profile.host, "localhost");
  assert.equal(profile.user.username, "root");
  assert.equal(profile.user.password.type, "env");
  assert.equal(profile.user.password.key, "MYSQL_ROOT_PASSWORD");

  assert.equal(await loader.getDefault(), "taurus_mcp");
});

test("profile loader allows a target template without configured SQL credentials", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
    },
  });
  const profile = await loader.get("taurus_mcp");
  assert.equal(profile.host, "localhost");
  assert.equal(profile.user, undefined);
});

test("profile loader creates a named credentialless datasource for interactive login", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({
      profilesPath: "/path/that/does/not/exist.json",
      defaultDatasource: "customer_instance",
    }),
    env: {
      TAURUSDB_SQL_DATASOURCE: "customer_instance",
    },
  });
  const profile = await loader.get("customer_instance");
  assert.ok(profile);
  assert.equal(profile.user, undefined);
  assert.equal(profile.host, undefined);
});

test("profile loader rejects partial configured SQL credentials", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
      TAURUSDB_SQL_USER: "reader",
    },
  });
  await assert.rejects(() => loader.load(), /require both username and password/);
});

test("profile loader preserves Huawei KMS password references as URI credentials", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
      TAURUSDB_SQL_USER: "root",
      TAURUSDB_SQL_PASSWORD: "hw-kms-file:~/.taurusdb-mcp/password.ciphertext",
    },
  });

  const profile = await loader.get("taurus_mcp");
  assert.ok(profile);
  assert.deepEqual(profile.user.password, {
    type: "uri",
    uri: "hw-kms-file:~/.taurusdb-mcp/password.ciphertext",
  });
});

test("profile loader preserves Huawei CSMS password references as URI credentials", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
      TAURUSDB_SQL_USER: "root",
      TAURUSDB_SQL_PASSWORD: "hw-csms:production-taurusdb-password",
    },
  });

  const profile = await loader.get("taurus_mcp");
  assert.ok(profile);
  assert.deepEqual(profile.user.password, {
    type: "uri",
    uri: "hw-csms:production-taurusdb-password",
  });
});

test("profile loader creates an implicit session datasource when SQL config is absent", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_CLOUD_REGION: "cn-north-4",
      TAURUSDB_CLOUD_ACCESS_KEY_ID: "ak",
      TAURUSDB_CLOUD_SECRET_ACCESS_KEY: "sk",
    },
  });

  const profiles = await loader.load();
  assert.equal(profiles.size, 1);

  const profile = profiles.get("taurus_mcp");
  assert.ok(profile);
  assert.equal(profile.engine, "mysql");
  assert.equal(profile.host, undefined);
  assert.equal(profile.port, 3306);
  assert.equal(profile.database, undefined);
  assert.equal(profile.user, undefined);
  assert.equal(await loader.getDefault(), "taurus_mcp");
});

test("profiles.json overrides env profile with same datasource name", async () => {
  const profilesPath = await createTempProfilesFile({
    dataSources: {
      shared: {
        engine: "mysql",
        host: "from-file",
        user: { username: "file_app", password: "file-secret" },
      },
    },
  });

  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath }),
    env: {
      TAURUSDB_SQL_DATASOURCE: "shared",
      TAURUSDB_SQL_DSN: "mysql://env_ro:env_pwd@from-env:3306/demo",
    },
  });

  const profile = await loader.get("shared");
  assert.ok(profile);
  assert.equal(profile.host, "from-file");
  assert.equal(profile.user.username, "file_app");
});

test("profile toString redacts password fields", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_DSN: "mysql://root:plain_password@localhost:3306/demo",
    },
  });

  const profile = await loader.get("taurus_mcp");
  assert.ok(profile);

  const rendered = profile.toString();
  assert.match(rendered, /\[REDACTED\]/);
  assert.doesNotMatch(rendered, /plain_password/);
});

test("profile loader supports env datasource templates without host", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_DATASOURCE: "taurus_mcp",
      TAURUSDB_SQL_ENGINE: "mysql",
      TAURUSDB_SQL_DATABASE: "app",
      TAURUSDB_SQL_USER: "ro",
      TAURUSDB_SQL_PASSWORD: "env:MYSQL_RO_PASSWORD",
    },
  });

  const profile = await loader.get("taurus_mcp");
  assert.ok(profile);
  assert.equal(profile.host, undefined);
  assert.equal(profile.port, 3306);
  assert.equal(profile.database, "app");
  assert.equal(profile.user.username, "ro");
});

test("profile loader accepts legacy readonlyUser aliases in profiles.json", async () => {
  const profilesPath = await createTempProfilesFile({
    dataSources: {
      legacy_profile: {
        engine: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "orders",
        readonlyUser: { username: "legacy_app", password: "env:LEGACY_APP_PASSWORD" },
      },
    },
  });

  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath }),
    env: {},
  });

  const profile = await loader.get("legacy_profile");
  assert.ok(profile);
  assert.equal(profile.user.username, "legacy_app");
  assert.equal(profile.user.password.type, "env");
  assert.equal(profile.user.password.key, "LEGACY_APP_PASSWORD");
});

test("runtime override profile loader applies host, port, and database bindings", async () => {
  const base = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_DATASOURCE: "taurus_mcp",
      TAURUSDB_SQL_DATABASE: "app",
      TAURUSDB_SQL_USER: "ro",
      TAURUSDB_SQL_PASSWORD: "env:MYSQL_RO_PASSWORD",
    },
  });
  const loader = new RuntimeOverrideProfileLoader(base);

  loader.setRuntimeTarget("taurus_mcp", {
    host: "10.0.0.8",
    port: 3307,
    database: "analytics",
    instanceId: "instance-1",
  });

  const profile = await loader.get("taurus_mcp");
  assert.ok(profile);
  assert.equal(profile.host, "10.0.0.8");
  assert.equal(profile.port, 3307);
  assert.equal(profile.database, "analytics");
  assert.equal(profile.user.username, "ro");
  assert.deepEqual(loader.getRuntimeTarget("taurus_mcp"), {
    host: "10.0.0.8",
    port: 3307,
    database: "analytics",
    instanceId: "instance-1",
    nodeId: undefined,
  });
});

test("runtime target changes clear previously bound runtime credentials", async () => {
  const base = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "base-host",
      TAURUSDB_SQL_USER: "base-reader",
      TAURUSDB_SQL_PASSWORD: "base-password",
    },
  });
  const loader = new RuntimeOverrideProfileLoader(base);
  loader.setRuntimeTarget("taurus_mcp", {
    host: "host-a",
    instanceId: "instance-a",
    user: { username: "runtime-reader", password: { type: "plain", value: "secret" } },
  });
  loader.setRuntimeTarget("taurus_mcp", { host: "host-b", instanceId: "instance-b" });
  assert.equal(loader.getRuntimeTarget("taurus_mcp").user, undefined);
  assert.equal((await loader.get("taurus_mcp")).user.username, "base-reader");
});
