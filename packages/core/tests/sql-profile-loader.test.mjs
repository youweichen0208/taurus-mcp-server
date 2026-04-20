import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfigFromEnv } from "../dist/config/index.js";
import { SqlProfileLoader } from "../dist/auth/sql-profile-loader.js";

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
        readonlyUser: { username: "ro", password: "env:RO_PWD" },
        mutationUser: { username: "rw", password: "env:RW_PWD" },
        poolSize: 8,
      },
      staging_analytics: {
        engine: "postgresql",
        host: "localhost",
        port: 5432,
        readonlyUser: { username: "analytics_ro", password: "file:/tmp/pwd.txt" },
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
  assert.equal(prod.readonlyUser.password.type, "env");
  assert.equal(prod.readonlyUser.password.key, "RO_PWD");
  assert.equal(prod.mutationUser.password.type, "env");
  assert.equal(prod.mutationUser.password.key, "RW_PWD");
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

  const profile = profiles.get("env_default");
  assert.ok(profile);
  assert.equal(profile.engine, "mysql");
  assert.equal(profile.host, "localhost");
  assert.equal(profile.readonlyUser.username, "root");
  assert.equal(profile.readonlyUser.password.type, "env");
  assert.equal(profile.readonlyUser.password.key, "MYSQL_ROOT_PASSWORD");

  assert.equal(await loader.getDefault(), "env_default");
});

test("profiles.json overrides env profile with same datasource name", async () => {
  const profilesPath = await createTempProfilesFile({
    dataSources: {
      shared: {
        engine: "mysql",
        host: "from-file",
        readonlyUser: { username: "file_ro", password: "file-secret" },
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
  assert.equal(profile.readonlyUser.username, "file_ro");
});

test("profile toString redacts password fields", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_DSN: "mysql://root:plain_password@localhost:3306/demo",
    },
  });

  const profile = await loader.get("env_default");
  assert.ok(profile);

  const rendered = profile.toString();
  assert.match(rendered, /\[REDACTED\]/);
  assert.doesNotMatch(rendered, /plain_password/);
});

test("env mutation user requires username and password together", async () => {
  const loader = new SqlProfileLoader({
    config: makeConfig({ profilesPath: "/path/that/does/not/exist.json" }),
    env: {
      TAURUSDB_SQL_HOST: "localhost",
      TAURUSDB_SQL_USER: "ro",
      TAURUSDB_SQL_PASSWORD: "pwd",
      TAURUSDB_SQL_MUTATION_USER: "rw",
    },
  });

  await assert.rejects(
    async () => loader.load(),
    /TAURUSDB_SQL_MUTATION_USER and TAURUSDB_SQL_MUTATION_PASSWORD must be set together/,
  );
});
