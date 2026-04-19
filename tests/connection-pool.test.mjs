import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "../dist/config/index.js";
import { ConnectionPoolManager } from "../dist/executor/connection-pool.js";

function makeProfile({
  name = "local_mysql",
  engine = "mysql",
  host = "127.0.0.1",
  port = 3306,
  database = "demo",
  readonlyUser = { username: "ro", password: { type: "plain", value: "ro_pwd" } },
  mutationUser = { username: "rw", password: { type: "plain", value: "rw_pwd" } },
} = {}) {
  return {
    name,
    engine,
    host,
    port,
    database,
    readonlyUser,
    mutationUser,
    toString() {
      return JSON.stringify({ name, engine, host, port, database, readonlyUser, mutationUser });
    },
  };
}

function makeProfileLoader(profilesMap) {
  return {
    async load() {
      return new Map(profilesMap);
    },
    async getDefault() {
      if (profilesMap.size === 1) {
        return profilesMap.keys().next().value;
      }
      return undefined;
    },
    async get(name) {
      return profilesMap.get(name);
    },
  };
}

function makeSecretResolver() {
  return {
    async resolve(ref) {
      if (ref.type === "plain") {
        return ref.value;
      }
      if (ref.type === "env") {
        return `env-${ref.key}`;
      }
      if (ref.type === "file") {
        return `file-${ref.path}`;
      }
      return `uri-${ref.uri}`;
    },
  };
}

function makeMockAdapter() {
  const state = {
    createPoolCalls: [],
    acquireCalls: 0,
    executeCalls: [],
    cancelCalls: 0,
    releaseCalls: 0,
    closeCalls: 0,
  };

  const adapter = {
    async createPool(input) {
      state.createPoolCalls.push(input);
      return {
        async acquire() {
          state.acquireCalls += 1;
          return {
            async execute(sql, options) {
              state.executeCalls.push({ sql, options });
              return {
                rows: [[1]],
                rowCount: 1,
              };
            },
            async cancel() {
              state.cancelCalls += 1;
            },
            async release() {
              state.releaseCalls += 1;
            },
          };
        },
        async close() {
          state.closeCalls += 1;
        },
      };
    },
  };

  return { adapter, state };
}

test("connection pool acquires readonly sessions and reuses underlying pool", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const s1 = await manager.acquire(profile.name, "ro");
  const r1 = await s1.execute("SELECT 1");
  assert.equal(r1.rowCount, 1);
  await s1.close();

  const s2 = await manager.acquire(profile.name, "ro");
  await s2.close();

  assert.equal(state.createPoolCalls.length, 1);
  assert.equal(state.acquireCalls, 2);
  assert.equal(state.releaseCalls, 2);
});

test("connection pool resolves credentials before creating pool", async () => {
  const profile = makeProfile({
    readonlyUser: { username: "ro", password: { type: "env", key: "DB_PWD" } },
  });
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const session = await manager.acquire(profile.name, "ro");
  await session.close();

  assert.equal(state.createPoolCalls.length, 1);
  assert.equal(state.createPoolCalls[0].password, "env-DB_PWD");
});

test("connection pool blocks mutation acquire when mutation mode disabled", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({ TAURUSDB_MCP_ENABLE_MUTATIONS: "false" }),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  await assert.rejects(async () => manager.acquire(profile.name, "rw"), /Mutation mode is disabled/);
});

test("connection pool blocks mutation acquire when mutation user is missing", async () => {
  const profile = makeProfile();
  delete profile.mutationUser;
  const profiles = new Map([[profile.name, profile]]);
  const { adapter } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({ TAURUSDB_MCP_ENABLE_MUTATIONS: "true" }),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  await assert.rejects(async () => manager.acquire(profile.name, "rw"), /Mutation user is not configured/);
});

test("connection pool health check returns readonly result and skips mutation when disabled", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({ TAURUSDB_MCP_ENABLE_MUTATIONS: "false" }),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const health = await manager.healthCheck(profile.name);
  assert.equal(health.datasource, profile.name);
  assert.equal(health.modes.length, 2);
  assert.equal(health.modes[0].mode, "ro");
  assert.equal(health.modes[0].status, "ok");
  assert.equal(health.modes[1].mode, "rw");
  assert.equal(health.modes[1].status, "skipped");
});

test("connection pool close releases active sessions and closes created pools", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const session = await manager.acquire(profile.name, "ro");
  await session.execute("SELECT 1");
  await manager.close();

  assert.equal(state.releaseCalls, 1);
  assert.equal(state.closeCalls, 1);
});

test("connection pool reports missing adapter as connection failure", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: {},
  });

  await assert.rejects(
    async () => manager.acquire(profile.name, "ro"),
    /No driver adapter registered for engine/,
  );
});
