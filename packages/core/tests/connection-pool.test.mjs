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
  user = { username: "app", password: { type: "plain", value: "app_pwd" } },
  mutationUser = {
    username: "writer",
    password: { type: "plain", value: "writer_pwd" },
  },
} = {}) {
  return {
    name,
    engine,
    host,
    port,
    database,
    user,
    mutationUser,
    toString() {
      return JSON.stringify({ name, engine, host, port, database, user });
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
  assert.deepEqual(state.createPoolCalls[0].tls, {
    enabled: true,
    rejectUnauthorized: true,
    servername: undefined,
  });
});

test("connection pool rejects insecure TLS overrides under the default policy", async () => {
  const profile = makeProfile();
  profile.tls = { enabled: false };
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();
  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  await assert.rejects(
    () => manager.acquire(profile.name, "ro"),
    /TLS is required by server policy/,
  );
  assert.equal(state.createPoolCalls.length, 0);
});

test("connection pool permits an explicit local TLS opt-out only when server policy allows it", async () => {
  const profile = makeProfile();
  profile.tls = { enabled: false };
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();
  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({ TAURUSDB_REQUIRE_TLS: "false" }),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const session = await manager.acquire(profile.name, "ro");
  await session.close();
  assert.equal(state.createPoolCalls[0].tls.enabled, false);
});

test("connection pool resolves credentials before creating pool", async () => {
  const profile = makeProfile({
    user: { username: "app", password: { type: "env", key: "DB_PWD" } },
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

test("connection pool acquires rw sessions with the dedicated mutation user", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const session = await manager.acquire(profile.name, "rw");
  await session.close();

  assert.equal(state.createPoolCalls.length, 1);
  assert.equal(state.createPoolCalls[0].username, "writer");
});

test("connection pool rejects rw sessions without dedicated mutation credentials", async () => {
  const profile = makeProfile();
  delete profile.mutationUser;
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  await assert.rejects(
    () => manager.acquire(profile.name, "rw"),
    /does not define mutation SQL credentials/,
  );
  assert.equal(state.createPoolCalls.length, 0);
});

test("connection pool isolates pools by effective database", async () => {
  const profile = makeProfile({ database: "tenant_a" });
  const profiles = new Map([[profile.name, profile]]);
  const { adapter, state } = makeMockAdapter();
  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  const a = await manager.acquire(profile.name, "ro", { database: "tenant_a" });
  const b = await manager.acquire(profile.name, "ro", { database: "tenant_b" });
  await a.close();
  await b.close();

  assert.equal(state.createPoolCalls.length, 2);
  assert.deepEqual(state.createPoolCalls.map((call) => call.database), ["tenant_a", "tenant_b"]);
});

test("connection pool health check returns readonly and mutation results", async () => {
  const profile = makeProfile();
  const profiles = new Map([[profile.name, profile]]);
  const { adapter } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
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
  assert.equal(health.modes[1].status, "ok");
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

test("connection pool requests configured SQL credentials when datasource user is absent", async () => {
  const profile = makeProfile();
  delete profile.user;
  const profiles = new Map([[profile.name, profile]]);
  const { adapter } = makeMockAdapter();

  const manager = new ConnectionPoolManager({
    config: createConfigFromEnv({}),
    profileLoader: makeProfileLoader(profiles),
    secretResolver: makeSecretResolver(),
    adapters: { mysql: adapter },
  });

  await assert.rejects(
    async () => manager.acquire(profile.name, "ro"),
    /does not define read-only SQL credentials/,
  );
});
