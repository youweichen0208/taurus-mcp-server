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

test("engine exposes evidence-backed slow/connection/lock diagnosis plus stable scaffold contracts", async () => {
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
    executor: {
      async explain() {
        return {
          queryId: "qry_explain_1",
          plan: [{ table: "orders", Extra: "Using filesort; Using temporary" }],
          riskSummary: {
            fullTableScanLikely: true,
            indexHitLikely: false,
            estimatedRows: 250_000,
            usesTempStructure: true,
            usesFilesort: true,
            riskHints: ["full table scan likely"],
          },
          recommendations: ["Add a covering index for the filter and sort columns."],
          durationMs: 9,
        };
      },
      async executeReadonly(sql) {
        if (sql.includes("events_statements_history_long")) {
          return {
            queryId: "qry_wait_history_1",
            columns: [
              { name: "event_name" },
              { name: "sample_count" },
              { name: "statement_count" },
              { name: "total_wait_ms" },
              { name: "avg_wait_ms" },
            ],
            rows: [
              ["wait/lock/metadata/sql/mdl", 6, 2, 180.5, 30.083],
              ["wait/io/table/sql/handler", 4, 2, 48.0, 12.0],
            ],
            rowCount: 2,
            originalRowCount: 2,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 4,
          };
        }
        if (sql.includes("events_statements_summary_by_digest")) {
          return {
            queryId: "qry_digest_1",
            columns: [
              { name: "schema_name" },
              { name: "digest" },
              { name: "digest_text" },
              { name: "query_sample_text" },
              { name: "exec_count" },
              { name: "avg_latency_ms" },
              { name: "max_latency_ms" },
              { name: "avg_lock_time_ms" },
              { name: "avg_rows_examined" },
              { name: "avg_sort_rows" },
              { name: "avg_tmp_tables" },
              { name: "avg_tmp_disk_tables" },
              { name: "select_scan_count" },
              { name: "no_index_used_count" },
            ],
            rows: [
              [
                "demo",
                "digest_1",
                "SELECT * FROM orders ORDER BY created_at DESC",
                "SELECT * FROM orders ORDER BY created_at DESC",
                12,
                87.5,
                240.0,
                25.0,
                50000,
                50000,
                1,
                1,
                12,
                12,
              ],
            ],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 5,
          };
        }
        if (sql.includes("performance_schema.data_lock_waits")) {
          return {
            queryId: "qry_lock_waits_1",
            columns: [
              { name: "waiting_session_id" },
              { name: "waiting_user" },
              { name: "waiting_state" },
              { name: "waiting_trx_state" },
              { name: "wait_age_seconds" },
              { name: "blocking_session_id" },
              { name: "blocking_user" },
              { name: "blocking_state" },
              { name: "blocking_trx_state" },
              { name: "blocking_trx_age_seconds" },
              { name: "locked_schema" },
              { name: "locked_table" },
              { name: "locked_index" },
              { name: "waiting_lock_type" },
              { name: "waiting_lock_mode" },
              { name: "blocking_lock_type" },
              { name: "blocking_lock_mode" },
            ],
            rows: [
              [301, "app_user", "update", "LOCK WAIT", 95, 201, "app_user", "updating", "RUNNING", 240, "demo", "orders", "PRIMARY", "RECORD", "X", "RECORD", "X"],
              [302, "app_user", "update", "LOCK WAIT", 72, 201, "app_user", "updating", "RUNNING", 240, "demo", "orders", "PRIMARY", "RECORD", "X", "RECORD", "X"],
            ],
            rowCount: 2,
            originalRowCount: 2,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 6,
          };
        }
        return {
          queryId: "qry_processlist_1",
          columns: [
            { name: "session_id" },
            { name: "user" },
            { name: "host" },
            { name: "database_name" },
            { name: "command" },
            { name: "time_seconds" },
            { name: "state" },
          ],
          rows: [
            [101, "app_user", "10.0.0.8:51000", "demo", "Sleep", 95, "idle"],
            [102, "app_user", "10.0.0.8:51001", "demo", "Query", 82, "executing"],
            [103, "app_user", "10.0.0.8:51002", "demo", "Query", 66, "sending data"],
          ],
          rowCount: 3,
          originalRowCount: 3,
          truncated: false,
          rowTruncated: false,
          columnTruncated: false,
          fieldTruncated: false,
          redactedColumns: [],
          droppedColumns: [],
          truncatedColumns: [],
          durationMs: 7,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const slowQuery = await engine.diagnoseSlowQuery(
    { sql: "SELECT * FROM orders ORDER BY created_at DESC" },
    ctx,
  );
  const lockContention = await engine.diagnoseLockContention({ table: "orders" }, ctx);
  const connectionSpike = await engine.diagnoseConnectionSpike({ user: "app_user" }, ctx);
  const replicationLag = await engine.diagnoseReplicationLag({ replicaId: "replica-1" }, ctx);
  const storagePressure = await engine.diagnoseStoragePressure({ scope: "table", table: "orders" }, ctx);

  assert.equal(slowQuery.tool, "diagnose_slow_query");
  assert.equal(slowQuery.status, "ok");
  assert.equal(slowQuery.severity, "high");
  assert.equal(slowQuery.rootCauseCandidates[0].code, "slow_query_full_table_scan");
  assert.equal(slowQuery.evidence[0].source, "explain");
  assert.match(slowQuery.recommendedActions[0], /index/i);

  const slowQueryFromDigest = await engine.diagnoseSlowQuery(
    { digestText: "SELECT * FROM orders ORDER BY created_at DESC", maxCandidates: 10 },
    ctx,
  );
  assert.equal(slowQueryFromDigest.tool, "diagnose_slow_query");
  assert.equal(slowQueryFromDigest.status, "ok");
  assert.equal(slowQueryFromDigest.evidence[0].source, "statement_digest");
  assert.match(slowQueryFromDigest.evidence[0].summary, /avg_lock_time_ms=25/);
  assert.match(slowQueryFromDigest.evidence[0].summary, /avg_rows_examined=50000/);
  assert.ok(
    slowQueryFromDigest.evidence.some(
      (item) =>
        item.source === "statement_wait_history" &&
        /wait\/lock\/metadata\/sql\/mdl/.test(item.summary),
    ),
  );
  assert.ok(
    slowQueryFromDigest.keyFindings.some((finding) => /25 ms of lock time per execution/i.test(finding)),
  );
  assert.ok(
    slowQueryFromDigest.keyFindings.some((finding) => /top nested wait event/i.test(finding)),
  );
  assert.ok(
    slowQueryFromDigest.rootCauseCandidates.some((candidate) => candidate.code === "slow_query_wait_event_lock_contention"),
  );
  assert.ok(
    slowQueryFromDigest.recommendedActions.some((action) => /blocker sessions|transaction scope/i.test(action)),
  );
  assert.equal(
    slowQueryFromDigest.suspiciousEntities.sqls[0].digestText,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );

  assert.equal(lockContention.tool, "diagnose_lock_contention");
  assert.equal(lockContention.status, "ok");
  assert.equal(lockContention.severity, "warning");
  assert.equal(lockContention.suspiciousEntities.sessions[0].sessionId, "201");
  assert.equal(lockContention.suspiciousEntities.tables[0].table, "demo.orders");
  assert.equal(lockContention.evidence[0].source, "lock_waits");

  assert.equal(connectionSpike.tool, "diagnose_connection_spike");
  assert.equal(connectionSpike.status, "ok");
  assert.equal(connectionSpike.severity, "warning");
  assert.equal(connectionSpike.suspiciousEntities.users[0].user, "app_user");
  assert.equal(connectionSpike.evidence[0].source, "processlist");
  assert.match(connectionSpike.recommendedActions[0], /show_processlist/);

  assert.equal(replicationLag.tool, "diagnose_replication_lag");
  assert.match(replicationLag.summary, /scaffolded/i);

  assert.equal(storagePressure.tool, "diagnose_storage_pressure");
  assert.equal(storagePressure.suspiciousEntities.tables[0].table, "orders");
});

test("engine can resolve slow-query SQL from an external Taurus slow-log source", async () => {
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
    executor: {
      async explain() {
        return {
          queryId: "qry_explain_external_1",
          plan: [],
          riskSummary: {
            fullTableScanLikely: false,
            indexHitLikely: true,
            estimatedRows: 1200,
            usesTempStructure: false,
            usesFilesort: false,
            riskHints: [],
          },
          recommendations: [],
          durationMs: 8,
        };
      },
      async executeReadonly() {
        return {
          queryId: "qry_readonly_unused",
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
          durationMs: 3,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
    slowSqlSource: {
      async resolve() {
        return {
          source: "taurus_api_slow_logs",
          sql: "SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC",
          sqlHash: "sql_hash_external_1",
          database: "demo",
          avgLatencyMs: 132.5,
          avgLockTimeMs: 18.2,
          avgRowsExamined: 4000,
          execCount: 6,
          rawRef: "taurus_api:/v3/project/instances/instance/slow-logs/statistics",
        };
      },
    },
  });

  const result = await engine.diagnoseSlowQuery(
    { sqlHash: "sql_hash_external_1", timeRange: { relative: "1h" } },
    ctx,
  );

  assert.equal(result.tool, "diagnose_slow_query");
  assert.equal(result.status, "ok");
  assert.ok(result.evidence.some((item) => item.source === "taurus_api_slow_logs"));
  assert.ok(
    result.evidence.some(
      (item) => item.source === "taurus_api_slow_logs" && /avg_lock_time_ms=18.2/.test(item.summary),
    ),
  );
  assert.ok(
    result.rootCauseCandidates.some((candidate) => candidate.code === "slow_query_lock_wait_pressure"),
  );
  assert.ok(
    result.suspiciousEntities.sqls.some((entry) => entry.sqlHash === "sql_hash_external_1"),
  );
});

test("engine delegates context, schema, guardrail, and executor methods", async () => {
  const ctx = makeContext();
  const expectedDatabases = [{ name: "demo" }];
  const expectedTables = [{ database: "demo", name: "users" }];
  const expectedSchema = { database: "demo", table: "users", columns: [], indexes: [] };
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
  assert.equal(
    await engine.inspectSql({ toolName: "execute_readonly_sql", sql: "SELECT 1", context: ctx }),
    expectedDecision,
  );
  assert.equal(await engine.explain("SELECT 1", ctx), expectedExplain);
  assert.equal(await engine.executeReadonly("SELECT 1", ctx, { maxRows: 10 }), expectedReadonly);
  assert.equal(
    await engine.showProcesslist({ user: "app_user", includeInfo: true, maxRows: 10 }, ctx),
    expectedReadonly,
  );
  assert.equal(
    await engine.showLockWaits({ table: "orders", includeSql: true, maxRows: 10 }, ctx),
    expectedReadonly,
  );
  assert.equal(await engine.executeMutation("UPDATE users SET x = 1", makeContext({ limits: { ...ctx.limits, readonly: false } }), { timeoutMs: 2000 }), expectedMutation);
  assert.equal(await engine.getQueryStatus("qry_2"), expectedStatus);
  assert.equal(await engine.cancelQuery("qry_2"), expectedCancel);
  assert.deepEqual(await engine.probeCapabilities(ctx), expectedCapabilitySnapshot);
  assert.equal(await engine.getKernelInfo(ctx), expectedKernelInfo);
  assert.equal(await engine.listFeatures(ctx), expectedFeatures);
  assert.deepEqual(await engine.explainEnhanced("SELECT 1", ctx), expectedEnhancedExplain);

  assert.equal(calls.length, 17);
  assert.deepEqual(calls[0], ["resolveContext", { datasource: "local_mysql" }, "task_001"]);
  assert.equal(calls[7][0], "executeReadonly");
  assert.match(calls[7][1], /FROM information_schema\.PROCESSLIST/);
  assert.equal(calls[8][0], "executeReadonly");
  assert.match(calls[8][1], /FROM performance_schema\.data_lock_waits/);
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
