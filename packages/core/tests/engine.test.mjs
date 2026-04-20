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
    schemaCache: {},
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: {},
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
    schemaCache: {},
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

  assert.equal(calls.length, 11);
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
    schemaCache: {},
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: store,
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
    schemaCache: {},
    schemaIntrospector: {},
    guardrail: {},
    executor: {},
    confirmationStore: new InMemoryConfirmationStore({ cleanupIntervalMs: 0 }),
  });

  await engine.close();
  assert.equal(closed, 1);
});
