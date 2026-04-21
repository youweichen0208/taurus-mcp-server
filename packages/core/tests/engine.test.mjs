import assert from "node:assert/strict";
import test from "node:test";

import { TaurusDBEngine } from "../dist/engine.js";
import { InMemoryConfirmationStore } from "../dist/safety/confirmation-store.js";

function makeConfig(overrides = {}) {
  return {
    defaultDatasource: undefined,
    profilesPath: undefined,
    enableMutations: false,
    limits: {
      maxRows: 200,
      maxColumns: 50,
      maxStatementMs: 15000,
      maxFieldChars: 2048,
    },
    audit: {
      logPath: "~/.taurusdb-mcp/audit.jsonl",
      includeRawSql: false,
    },
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    task_id: "task_001",
    datasource: "local_mysql",
    engine: "mysql",
    database: "demo",
    limits: {
      readonly: true,
      timeoutMs: 5000,
      maxRows: 200,
      maxColumns: 50,
      maxFieldChars: 2048,
    },
    ...overrides,
  };
}

function makeCapabilityProbe(overrides = {}) {
  return {
    async probe() {
      return {
        kernelInfo: {
          isTaurusDB: false,
          mysqlCompat: "8.0",
          rawVersion: "8.0.32",
        },
        features: {
          flashback_query: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          parallel_query: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          ndp_pushdown: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          offset_pushdown: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          recycle_bin: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          statement_outline: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          column_compression: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          multi_tenant: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          partition_mdl: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          dynamic_masking: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          nonblocking_ddl: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
          hot_row_update: { available: false, enabled: false, reason: "Instance is not TaurusDB." },
        },
        checkedAt: 1,
      };
    },
    async getKernelInfo(ctx) {
      return (await this.probe(ctx)).kernelInfo;
    },
    async listFeatures(ctx) {
      return (await this.probe(ctx)).features;
    },
    ...overrides,
  };
}

test("engine lists datasources through profile loader and marks default datasource", async () => {
  const profiles = new Map([
    [
      "beta",
      {
        name: "beta",
        engine: "mysql",
        host: "beta.db.local",
        port: 3306,
        database: "app_beta",
        readonlyUser: { username: "reader", password: { type: "plain", value: "secret" } },
        mutationUser: undefined,
        poolSize: 4,
      },
    ],
    [
      "alpha",
      {
        name: "alpha",
        engine: "postgresql",
        host: "alpha.db.local",
        port: 5432,
        database: "app_alpha",
        readonlyUser: { username: "reader", password: { type: "plain", value: "secret" } },
        mutationUser: { username: "writer", password: { type: "plain", value: "secret" } },
        poolSize: 8,
      },
    ],
  ]);

  const engine = new TaurusDBEngine({
    config: makeConfig(),
    profileLoader: {
      async load() {
        return profiles;
      },
      async getDefault() {
        return "alpha";
      },
      async get(name) {
        return profiles.get(name);
      },
    },
    secretResolver: {},
    datasourceResolver: {},
    connectionPool: { async close() {} },
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const datasources = await engine.listDataSources();
  assert.deepEqual(datasources, [
    {
      name: "alpha",
      engine: "postgresql",
      host: "alpha.db.local",
      port: 5432,
      database: "app_alpha",
      hasMutationUser: true,
      poolSize: 8,
      isDefault: true,
    },
    {
      name: "beta",
      engine: "mysql",
      host: "beta.db.local",
      port: 3306,
      database: "app_beta",
      hasMutationUser: false,
      poolSize: 4,
      isDefault: false,
    },
  ]);
  assert.equal(await engine.getDefaultDataSource(), "alpha");
});

test("engine exposes scaffolded diagnostic results with a stable contract", async () => {
  const ctx = makeContext();
  const engine = new TaurusDBEngine({
    config: makeConfig(),
    profileLoader: {
      async load() {
        return new Map();
      },
      async getDefault() {
        return undefined;
      },
      async get() {
        return undefined;
      },
    },
    secretResolver: {},
    datasourceResolver: {},
    connectionPool: { async close() {} },
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const slowQuery = await engine.diagnoseSlowQuery({ sqlHash: "sql_hash_1" }, ctx);
  const lockContention = await engine.diagnoseLockContention({ table: "orders" }, ctx);
  const connectionSpike = await engine.diagnoseConnectionSpike({ user: "app_user" }, ctx);
  const replicationLag = await engine.diagnoseReplicationLag({ replicaId: "replica-1" }, ctx);
  const storagePressure = await engine.diagnoseStoragePressure({ scope: "table", table: "orders" }, ctx);

  assert.equal(slowQuery.tool, "diagnose_slow_query");
  assert.equal(slowQuery.status, "inconclusive");
  assert.equal(slowQuery.rootCauseCandidates[0].confidence, "low");
  assert.equal(slowQuery.suspiciousEntities.sqls[0].sqlHash, "sql_hash_1");

  assert.equal(lockContention.tool, "diagnose_lock_contention");
  assert.equal(lockContention.suspiciousEntities.tables[0].table, "orders");

  assert.equal(connectionSpike.tool, "diagnose_connection_spike");
  assert.equal(connectionSpike.suspiciousEntities.users[0].user, "app_user");

  assert.equal(replicationLag.tool, "diagnose_replication_lag");
  assert.match(replicationLag.summary, /scaffolded/i);

  assert.equal(storagePressure.tool, "diagnose_storage_pressure");
  assert.equal(storagePressure.suspiciousEntities.tables[0].table, "orders");
});

test("engine delegates context, schema, guardrail, and executor methods", async () => {
  const ctx = makeContext();
  const expectedDatabases = [{ name: "demo" }];
  const expectedTables = [{ database: "demo", name: "users" }];
  const expectedSchema = { database: "demo", table: "users", columns: [], indexes: [] };
  const expectedSample = { database: "demo", table: "users", columns: [], rows: [] };
  const expectedDecision = {
    action: "allow",
    riskLevel: "low",
    reasonCodes: [],
    riskHints: [],
    normalizedSql: "SELECT 1",
    sqlHash: "hash_1",
    requiresExplain: false,
    requiresConfirmation: false,
    runtimeLimits: ctx.limits,
  };
  const expectedExplain = {
    queryId: "qry_1",
    plan: [],
    riskSummary: {
      fullTableScanLikely: false,
      indexHitLikely: true,
      estimatedRows: 1,
      usesTempStructure: false,
      usesFilesort: false,
      riskHints: [],
    },
    recommendations: [],
    durationMs: 10,
  };
  const expectedReadonly = {
    queryId: "qry_2",
    columns: [],
    rows: [],
    rowCount: 0,
    originalRowCount: 0,
    truncated: false,
    rowTruncated: false,
    columnTruncated: false,
    fieldTruncated: false,
    redactedColumns: [],
    droppedColumns: [],
    truncatedColumns: [],
    durationMs: 5,
  };
  const expectedMutation = { queryId: "qry_3", affectedRows: 2, durationMs: 8 };
  const expectedStatus = { queryId: "qry_2", status: "completed" };
  const expectedCancel = { queryId: "qry_2", status: "cancelled" };
  const expectedKernelInfo = {
    isTaurusDB: true,
    kernelVersion: "2.0.69.250900",
    mysqlCompat: "8.0",
    rawVersion: "8.0.32 TaurusDB 2.0.69.250900",
  };
  const expectedFeatures = {
    flashback_query: { available: true, enabled: true, minVersion: "2.0.69.250900" },
    parallel_query: { available: true, enabled: false, param: "force_parallel_execute=OFF" },
    ndp_pushdown: { available: true, enabled: true, mode: "REPLICA_ON" },
    offset_pushdown: { available: true, enabled: true },
    recycle_bin: { available: true, enabled: true, minVersion: "2.0.57.240900" },
    statement_outline: { available: true, enabled: false, minVersion: "2.0.42.230600" },
    column_compression: { available: true, minVersion: "2.0.54.240600" },
    multi_tenant: { available: true, enabled: false, active: false, minVersion: "2.0.54.240600" },
    partition_mdl: { available: true, minVersion: "2.0.57.240900" },
    dynamic_masking: { available: true, minVersion: "2.0.69.250900" },
    nonblocking_ddl: { available: true, minVersion: "2.0.54.240600" },
    hot_row_update: { available: true, minVersion: "2.0.54.240600" },
  };
  const expectedCapabilitySnapshot = {
    kernelInfo: expectedKernelInfo,
    features: expectedFeatures,
    checkedAt: 1,
  };
  const expectedEnhancedExplain = {
    standardPlan: expectedExplain,
    taurusHints: {
      ndpPushdown: {
        condition: false,
        columns: false,
        aggregate: false,
        blockedReason: undefined,
      },
      parallelQuery: {
        wouldEnable: false,
        estimatedDegree: undefined,
        blockedReason: "parallel_query is available but force_parallel_execute is disabled.",
      },
      offsetPushdown: false,
    },
    optimizationSuggestions: [
      "parallel_query is available but disabled. Consider SET GLOBAL force_parallel_execute=ON.",
    ],
  };

  const calls = [];
  const engine = new TaurusDBEngine({
    config: makeConfig(),
    profileLoader: {
      async load() {
        return new Map();
      },
      async getDefault() {
        return undefined;
      },
      async get() {
        return undefined;
    },
    },
    secretResolver: {},
    datasourceResolver: {
      async resolve(input, taskId) {
        calls.push(["resolveContext", input, taskId]);
        return ctx;
      },
    },
    connectionPool: { async close() {} },
    schemaIntrospector: {
      async listDatabases(arg) {
        calls.push(["listDatabases", arg]);
        return expectedDatabases;
      },
      async listTables(arg, database) {
        calls.push(["listTables", arg, database]);
        return expectedTables;
      },
      async describeTable(arg, database, table) {
        calls.push(["describeTable", arg, database, table]);
        return expectedSchema;
      },
      async sampleRows(arg, database, table, n) {
        calls.push(["sampleRows", arg, database, table, n]);
        return expectedSample;
      },
    },
    guardrail: {
      async inspect(input) {
        calls.push(["inspectSql", input]);
        return expectedDecision;
      },
    },
    executor: {
      async explain(sql, arg) {
        calls.push(["explain", sql, arg]);
        return expectedExplain;
      },
      async executeReadonly(sql, arg, opts) {
        calls.push(["executeReadonly", sql, arg, opts]);
        return expectedReadonly;
      },
      async executeMutation(sql, arg, opts) {
        calls.push(["executeMutation", sql, arg, opts]);
        return expectedMutation;
      },
      async getQueryStatus(queryId) {
        calls.push(["getQueryStatus", queryId]);
        return expectedStatus;
      },
      async cancelQuery(queryId) {
        calls.push(["cancelQuery", queryId]);
        return expectedCancel;
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe({
      async probe(arg) {
        calls.push(["probeCapabilities", arg]);
        return expectedCapabilitySnapshot;
      },
      async getKernelInfo(arg) {
        calls.push(["getKernelInfo", arg]);
        return expectedKernelInfo;
      },
      async listFeatures(arg) {
        calls.push(["listFeatures", arg]);
        return expectedFeatures;
      },
    }),
  });

  assert.equal(await engine.resolveContext({ datasource: "local_mysql" }, "task_001"), ctx);
  assert.equal(await engine.listDatabases(ctx), expectedDatabases);
  assert.equal(await engine.listTables(ctx, "demo"), expectedTables);
  assert.equal(await engine.describeTable(ctx, "demo", "users"), expectedSchema);
  assert.equal(await engine.sampleRows(ctx, "demo", "users", 5), expectedSample);
  assert.equal(
    await engine.inspectSql({ toolName: "execute_readonly_sql", sql: "SELECT 1", context: ctx }),
    expectedDecision,
  );
  assert.equal(await engine.explain("SELECT 1", ctx), expectedExplain);
  assert.equal(await engine.executeReadonly("SELECT 1", ctx, { maxRows: 10 }), expectedReadonly);
  assert.equal(await engine.executeMutation("UPDATE users SET x = 1", makeContext({ limits: { ...ctx.limits, readonly: false } }), { timeoutMs: 2000 }), expectedMutation);
  assert.equal(await engine.getQueryStatus("qry_2"), expectedStatus);
  assert.equal(await engine.cancelQuery("qry_2"), expectedCancel);
  assert.deepEqual(await engine.probeCapabilities(ctx), expectedCapabilitySnapshot);
  assert.equal(await engine.getKernelInfo(ctx), expectedKernelInfo);
  assert.equal(await engine.listFeatures(ctx), expectedFeatures);
  assert.deepEqual(await engine.explainEnhanced("SELECT 1", ctx), expectedEnhancedExplain);

  assert.equal(calls.length, 16);
  assert.deepEqual(calls[0], ["resolveContext", { datasource: "local_mysql" }, "task_001"]);
});

test("engine issues, validates, and handles confirmation tokens", async () => {
  let seed = 6;
  const store = new InMemoryConfirmationStore({
    now: () => 1_700_000_000_000,
    cleanupIntervalMs: 0,
    randomBytesFn: () => Buffer.alloc(32, ++seed),
  });
  const context = makeContext();

  const engine = new TaurusDBEngine({
    config: makeConfig(),
    profileLoader: {
      async load() {
        return new Map();
      },
      async getDefault() {
        return undefined;
      },
      async get() {
        return undefined;
      },
    },
    secretResolver: {},
    datasourceResolver: {},
    connectionPool: { async close() {} },
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: store,
    capabilityProbe: makeCapabilityProbe(),
  });

  const token = await engine.issueConfirmation({
    sql: "UPDATE users SET status = 'done' WHERE id = 1",
    context: { ...context, limits: { ...context.limits, readonly: false } },
    riskLevel: "high",
  });

  assert.match(token.token, /^ctok_/);
  const validation = await engine.validateConfirmation(
    token.token,
    "UPDATE users SET status = 'done' WHERE id = 1",
    { ...context, limits: { ...context.limits, readonly: false } },
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.action, "allow");

  const noopConfirmation = await engine.handleConfirmation(
    {
      action: "allow",
      riskLevel: "low",
      reasonCodes: [],
      riskHints: [],
      normalizedSql: "SELECT 1",
      sqlHash: "hash_select",
      requiresExplain: false,
      requiresConfirmation: false,
      runtimeLimits: context.limits,
    },
    context,
  );
  assert.deepEqual(noopConfirmation, { status: "confirmed" });

  const issued = await engine.handleConfirmation(
    {
      action: "confirm",
      riskLevel: "high",
      reasonCodes: ["R006"],
      riskHints: ["Mutation SQL with WHERE requires confirmation."],
      normalizedSql: "UPDATE users SET status = 'done' WHERE id = 1",
      sqlHash: "manual_hash",
      requiresExplain: false,
      requiresConfirmation: true,
      runtimeLimits: { ...context.limits, readonly: false },
    },
    { ...context, limits: { ...context.limits, readonly: false } },
  );
  assert.equal(issued.status, "token_issued");
  assert.match(issued.token, /^ctok_/);
});

test("engine close delegates pool shutdown", async () => {
  let closed = 0;
  const engine = new TaurusDBEngine({
    config: makeConfig(),
    profileLoader: {
      async load() {
        return new Map();
      },
      async getDefault() {
        return undefined;
      },
      async get() {
        return undefined;
      },
    },
    secretResolver: {},
    datasourceResolver: {},
    connectionPool: {
      async close() {
        closed += 1;
      },
    },
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: new InMemoryConfirmationStore({ cleanupIntervalMs: 0 }),
    capabilityProbe: makeCapabilityProbe(),
  });

  await engine.close();
  assert.equal(closed, 1);
});
