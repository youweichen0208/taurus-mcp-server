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
          flashback_query: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          parallel_query: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          ndp_pushdown: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          offset_pushdown: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          recycle_bin: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          statement_outline: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          column_compression: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          multi_tenant: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          partition_mdl: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          dynamic_masking: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          nonblocking_ddl: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
          hot_row_update: {
            available: false,
            enabled: false,
            reason: "Instance is not TaurusDB.",
          },
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
        readonlyUser: {
          username: "reader",
          password: { type: "plain", value: "secret" },
        },
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
        readonlyUser: {
          username: "reader",
          password: { type: "plain", value: "secret" },
        },
        mutationUser: {
          username: "writer",
          password: { type: "plain", value: "secret" },
        },
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
          recommendations: [
            "Add a covering index for the filter and sort columns.",
          ],
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
              { name: "total_latency_ms" },
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
                1050,
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
              [
                301,
                "app_user",
                "update",
                "LOCK WAIT",
                95,
                201,
                "app_user",
                "updating",
                "RUNNING",
                240,
                "demo",
                "orders",
                "PRIMARY",
                "RECORD",
                "X",
                "RECORD",
                "X",
              ],
              [
                302,
                "app_user",
                "update",
                "LOCK WAIT",
                72,
                201,
                "app_user",
                "updating",
                "RUNNING",
                240,
                "demo",
                "orders",
                "PRIMARY",
                "RECORD",
                "X",
                "RECORD",
                "X",
              ],
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
        if (sql.includes("performance_schema.metadata_locks")) {
          return {
            queryId: "qry_metadata_locks_1",
            columns: [
              { name: "waiting_session_id" },
              { name: "waiting_user" },
              { name: "waiting_state" },
              { name: "blocking_session_id" },
              { name: "blocking_user" },
              { name: "blocking_state" },
              { name: "object_type" },
              { name: "object_schema" },
              { name: "object_name" },
              { name: "waiting_lock_type" },
              { name: "waiting_lock_duration" },
              { name: "blocking_lock_type" },
              { name: "blocking_lock_duration" },
            ],
            rows: [
              [
                401,
                "app_user",
                "Waiting for table metadata lock",
                201,
                "app_user",
                "altering table",
                "TABLE",
                "demo",
                "orders",
                "SHARED_UPGRADABLE",
                "TRANSACTION",
                "EXCLUSIVE",
                "TRANSACTION",
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
            durationMs: 4,
          };
        }
        if (sql === "SHOW ENGINE INNODB STATUS") {
          return {
            queryId: "qry_innodb_status_1",
            columns: [{ name: "Type" }, { name: "Name" }, { name: "Status" }],
            rows: [[
              "InnoDB",
              "",
              `LATEST DETECTED DEADLOCK
2026-04-27 12:00:00
*** (1) TRANSACTION:
TRANSACTION 12345, ACTIVE 10 sec
WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 1 page no 1 index PRIMARY of table \`demo\`.\`orders\`
*** (2) TRANSACTION:
TRANSACTION 67890, ACTIVE 12 sec
HOLDS THE LOCK(S):
RECORD LOCKS space id 1 page no 1 index PRIMARY of table \`demo\`.\`orders\`
*** WE ROLL BACK TRANSACTION (1)`,
            ]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 3,
          };
        }
        if (sql.includes("information_schema.TABLES")) {
          return {
            queryId: "qry_table_storage_1",
            columns: [
              { name: "schema_name" },
              { name: "table_name" },
              { name: "engine" },
              { name: "row_count_estimate" },
              { name: "total_mb" },
              { name: "data_mb" },
              { name: "index_mb" },
              { name: "data_free_mb" },
            ],
            rows: [
              ["demo", "orders", "InnoDB", 250000, 96.5, 64.25, 32.25, 4.0],
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
            durationMs: 3,
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
            [
              102,
              "app_user",
              "10.0.0.8:51001",
              "demo",
              "Query",
              82,
              "executing",
            ],
            [
              103,
              "app_user",
              "10.0.0.8:51002",
              "demo",
              "Query",
              66,
              "sending data",
            ],
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
  const serviceLatency = await engine.diagnoseServiceLatency(
    { symptom: "timeout", user: "app_user" },
    ctx,
  );
  const dbHotspot = await engine.diagnoseDbHotspot({ scope: "session" }, ctx);
  const lockContention = await engine.diagnoseLockContention(
    { table: "orders", maxCandidates: 10 },
    ctx,
  );
  const connectionSpike = await engine.diagnoseConnectionSpike(
    { user: "app_user" },
    ctx,
  );
  const replicationLag = await engine.diagnoseReplicationLag(
    { replicaId: "replica-1" },
    ctx,
  );
  const storagePressure = await engine.diagnoseStoragePressure(
    { scope: "table", table: "orders" },
    ctx,
  );

  assert.equal(slowQuery.tool, "diagnose_slow_query");
  assert.equal(slowQuery.status, "ok");
  assert.equal(slowQuery.severity, "high");
  assert.equal(
    slowQuery.rootCauseCandidates[0].code,
    "slow_query_full_table_scan",
  );
  assert.equal(
    slowQuery.evidence.some((item) => item.source === "statement_digest"),
    true,
  );
  assert.equal(
    slowQuery.evidence.some((item) => item.source === "statement_wait_history"),
    true,
  );
  assert.match(slowQuery.recommendedActions[0], /index/i);
  assert.equal(
    slowQuery.suspiciousEntities.sqls[0].digestText,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );

  const slowQueryFromDigest = await engine.diagnoseSlowQuery(
    {
      digestText: "SELECT * FROM orders ORDER BY created_at DESC",
      maxCandidates: 10,
    },
    ctx,
  );
  assert.equal(slowQueryFromDigest.tool, "diagnose_slow_query");
  assert.equal(slowQueryFromDigest.status, "ok");
  assert.equal(slowQueryFromDigest.evidence[0].source, "statement_digest");
  assert.match(slowQueryFromDigest.evidence[0].summary, /avg_lock_time_ms=25/);
  assert.match(
    slowQueryFromDigest.evidence[0].summary,
    /avg_rows_examined=50000/,
  );
  assert.ok(
    slowQueryFromDigest.evidence.some(
      (item) =>
        item.source === "statement_wait_history" &&
        /wait\/lock\/metadata\/sql\/mdl/.test(item.summary),
    ),
  );
  assert.ok(
    slowQueryFromDigest.keyFindings.some((finding) =>
      /25 ms of lock time per execution/i.test(finding),
    ),
  );
  assert.ok(
    slowQueryFromDigest.keyFindings.some((finding) =>
      /top nested wait event/i.test(finding),
    ),
  );
  assert.ok(
    slowQueryFromDigest.rootCauseCandidates.some(
      (candidate) => candidate.code === "slow_query_wait_event_lock_contention",
    ),
  );
  assert.ok(
    slowQueryFromDigest.recommendedActions.some((action) =>
      /blocker sessions|transaction scope/i.test(action),
    ),
  );
  assert.equal(
    slowQueryFromDigest.suspiciousEntities.sqls[0].digestText,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );

  assert.equal(serviceLatency.tool, "diagnose_service_latency");
  assert.equal(serviceLatency.status, "ok");
  assert.equal(serviceLatency.suspectedCategory, "lock_contention");
  assert.equal(
    serviceLatency.topCandidates.some(
      (candidate) => candidate.type === "session",
    ),
    true,
  );
  assert.equal(
    serviceLatency.recommendedNextTools.includes("diagnose_lock_contention"),
    true,
  );
  assert.equal(serviceLatency.nextToolInputs[0].tool, "diagnose_slow_query");
  assert.equal(
    serviceLatency.nextToolInputs[0].input.sql,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );
  assert.equal(
    serviceLatency.nextToolInputs.some(
      (item) =>
        item.tool === "diagnose_lock_contention" &&
        item.input.table === "demo.orders",
    ),
    true,
  );
  assert.equal(
    serviceLatency.nextToolInputs.some(
      (item) => item.tool === "show_processlist",
    ),
    true,
  );

  assert.equal(dbHotspot.tool, "diagnose_db_hotspot");
  assert.equal(dbHotspot.status, "ok");
  assert.equal(dbHotspot.scope, "session");
  assert.equal(
    dbHotspot.hotspots.some((item) => item.type === "session"),
    true,
  );
  assert.equal(
    dbHotspot.recommendedNextTools.includes("show_processlist"),
    true,
  );
  assert.equal(
    dbHotspot.nextToolInputs.some(
      (item) =>
        item.tool === "diagnose_lock_contention" &&
        item.input.blocker_session_id === "201",
    ),
    true,
  );
  assert.equal(
    dbHotspot.nextToolInputs.some((item) => item.tool === "show_processlist"),
    true,
  );

  assert.equal(lockContention.tool, "diagnose_lock_contention");
  assert.equal(lockContention.status, "ok");
  assert.equal(lockContention.severity, "warning");
  assert.equal(lockContention.suspiciousEntities.sessions[0].sessionId, "201");
  assert.equal(
    lockContention.suspiciousEntities.tables[0].table,
    "demo.orders",
  );
  assert.equal(lockContention.evidence[0].source, "lock_waits");
  assert.equal(
    lockContention.evidence.some((item) => item.source === "metadata_locks"),
    true,
  );
  assert.equal(
    lockContention.evidence.some((item) => item.source === "deadlock_history"),
    true,
  );
  assert.equal(
    lockContention.rootCauseCandidates.some(
      (candidate) => candidate.code === "lock_contention_metadata_lock_blocker",
    ),
    true,
  );

  assert.equal(connectionSpike.tool, "diagnose_connection_spike");
  assert.equal(connectionSpike.status, "ok");
  assert.equal(connectionSpike.severity, "warning");
  assert.equal(connectionSpike.suspiciousEntities.users[0].user, "app_user");
  assert.equal(connectionSpike.evidence[0].source, "processlist");
  assert.match(connectionSpike.recommendedActions[0], /show_processlist/);

  assert.equal(replicationLag.tool, "diagnose_replication_lag");
  assert.equal(replicationLag.status, "not_applicable");
  assert.equal(
    replicationLag.rootCauseCandidates[0].code,
    "replication_lag_no_evidence",
  );
  assert.equal(
    replicationLag.recommendedNextTools.includes("show_processlist"),
    true,
  );
  assert.equal(replicationLag.nextToolInputs[0].tool, "show_processlist");
  assert.equal(replicationLag.nextToolInputs[0].input.include_idle, false);

  assert.equal(storagePressure.tool, "diagnose_storage_pressure");
  assert.equal(storagePressure.status, "ok");
  assert.equal(
    storagePressure.rootCauseCandidates.some(
      (candidate) => candidate.code === "storage_pressure_tmp_disk_spill",
    ),
    true,
  );
  assert.equal(
    storagePressure.evidence.some((item) => item.source === "table_storage"),
    true,
  );
  assert.equal(
    storagePressure.suspiciousEntities.tables[0].table,
    "demo.orders",
  );
  assert.equal(
    storagePressure.recommendedNextTools.includes("diagnose_slow_query"),
    true,
  );
  assert.equal(
    storagePressure.nextToolInputs.some(
      (item) =>
        item.tool === "diagnose_slow_query" &&
        item.input.sql ===
          "SELECT * FROM orders ORDER BY created_at DESC",
    ),
    true,
  );
  assert.equal(
    storagePressure.nextToolInputs.some(
      (item) =>
        item.tool === "diagnose_db_hotspot" &&
        item.input.scope === "table",
    ),
    true,
  );
});

test("engine ranks top slow SQL digests for symptom-entry analysis", async () => {
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
        throw new Error("not used");
      },
      async executeReadonly(sql) {
        assert.match(sql, /events_statements_summary_by_digest/);
        return {
          queryId: "qry_top_digest_1",
          columns: [
            { name: "schema_name" },
            { name: "digest" },
            { name: "digest_text" },
            { name: "query_sample_text" },
            { name: "exec_count" },
            { name: "avg_latency_ms" },
            { name: "total_latency_ms" },
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
              1050,
              240.0,
              25.0,
              50000,
              50000,
              1,
              1,
              12,
              12,
            ],
            [
              "demo",
              "digest_2",
              "SELECT customer_id, SUM(amount) FROM payments GROUP BY customer_id",
              "SELECT customer_id, SUM(amount) FROM payments GROUP BY customer_id",
              8,
              65.25,
              522,
              90.0,
              1.1,
              12000,
              3000,
              0,
              0,
              8,
              0,
            ],
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
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const result = await engine.findTopSlowSql(
    { topN: 2, sortBy: "total_latency", timeRange: { relative: "15m" } },
    ctx,
  );

  assert.equal(result.tool, "find_top_slow_sql");
  assert.equal(result.status, "ok");
  assert.equal(result.topSqls.length, 2);
  assert.equal(
    result.topSqls[0].digestText,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );
  assert.equal(result.topSqls[0].evidenceSources[0], "statement_digest");
  assert.equal(result.evidence[0].source, "statement_digest");
  assert.match(
    result.summary,
    /top slow sql discovery collected 2 suspect statements/i,
  );
});

test("engine matches provided SQL to digest summaries by query shape", async () => {
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
        throw new Error("not used");
      },
      async executeReadonly(sql) {
        assert.match(sql, /events_statements_summary_by_digest/);
        return {
          queryId: "qry_digest_shape_1",
          columns: [
            { name: "schema_name" },
            { name: "digest" },
            { name: "digest_text" },
            { name: "query_sample_text" },
            { name: "exec_count" },
            { name: "avg_latency_ms" },
            { name: "total_latency_ms" },
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
              "digest_miss",
              "SELECT * FROM orders WHERE region = ?",
              "SELECT * FROM orders WHERE region = 'eu'",
              50,
              20,
              1000,
              80,
              0,
              200,
              0,
              0,
              0,
              0,
              0,
            ],
            [
              "demo",
              "digest_shape",
              "SELECT * FROM `orders` WHERE `status` = ? AND `customer_id` = ?",
              "SELECT * FROM orders WHERE status = 'pending' AND customer_id = 42",
              12,
              90,
              1080,
              160,
              12,
              8000,
              0,
              1,
              0,
              0,
              0,
            ],
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
          durationMs: 5,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const result = await engine.findStatementDigestSampleForSql(
    "select * from orders where status='paid' and customer_id=7",
    ctx,
  );

  assert.equal(result.digest, "digest_shape");
  assert.equal(
    result.digestText,
    "SELECT * FROM `orders` WHERE `status` = ? AND `customer_id` = ?",
  );
});

test("engine falls back to table-hinted digest lookup for provided SQL", async () => {
  const ctx = makeContext();
  let digestQueryCount = 0;
  const digestColumns = [
    { name: "schema_name" },
    { name: "digest" },
    { name: "digest_text" },
    { name: "query_sample_text" },
    { name: "exec_count" },
    { name: "avg_latency_ms" },
    { name: "total_latency_ms" },
    { name: "max_latency_ms" },
    { name: "avg_lock_time_ms" },
    { name: "avg_rows_examined" },
    { name: "avg_sort_rows" },
    { name: "avg_tmp_tables" },
    { name: "avg_tmp_disk_tables" },
    { name: "select_scan_count" },
    { name: "no_index_used_count" },
  ];
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
      async executeReadonly(sql) {
        digestQueryCount += 1;
        assert.match(sql, /events_statements_summary_by_digest/);
        if (digestQueryCount === 1) {
          assert.doesNotMatch(sql, /storage_pressure_events/);
          return {
            queryId: "qry_digest_top_without_target",
            columns: digestColumns,
            rows: [
              [
                "demo",
                "digest_other",
                "SELECT * FROM unrelated_table WHERE id = ?",
                "SELECT * FROM unrelated_table WHERE id = 1",
                100,
                10,
                1000,
                20,
                0,
                1,
                0,
                0,
                0,
                0,
                0,
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
            durationMs: 2,
          };
        }
        return {
          queryId: "qry_digest_table_hint",
          columns: digestColumns,
          rows: [
            [
              "demo",
              "digest_pressure",
              "SELECT `category` , `payload` , COUNT ( * ) AS `event_count` FROM `storage_pressure_events` GROUP BY `category` , `payload` ORDER BY `payload` LIMIT ?",
              "SELECT category, payload, COUNT(*) AS event_count FROM storage_pressure_events GROUP BY category, payload ORDER BY payload LIMIT 5",
              3,
              15,
              45,
              20,
              0,
              505,
              5,
              1,
              1,
              3,
              3,
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
          durationMs: 3,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const result = await engine.findStatementDigestSampleForSql(
    "SELECT category, payload, COUNT(*) AS event_count FROM storage_pressure_events GROUP BY category, payload ORDER BY payload LIMIT 5",
    ctx,
  );

  assert.equal(result.digest, "digest_pressure");
  assert.equal(digestQueryCount, 2);
});

test("engine classifies local slow-query runtime wait and spill signals", async () => {
  const cases = [
    {
      name: "io wait",
      waitEventName: "wait/io/table/sql/handler",
      avgTmpDiskTables: 0,
      expectedCode: "slow_query_wait_event_io_pressure",
    },
    {
      name: "sync wait",
      waitEventName: "wait/synch/mutex/innodb/buf_pool_mutex",
      avgTmpDiskTables: 0,
      expectedCode: "slow_query_wait_event_sync_contention",
    },
    {
      name: "tmp disk spill",
      waitEventName: undefined,
      avgTmpDiskTables: 2,
      expectedCode: "slow_query_tmp_disk_spill",
    },
  ];

  for (const item of cases) {
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
            queryId: `qry_${item.name.replace(/\s/g, "_")}`,
            plan: [],
            riskSummary: {
              fullTableScanLikely: false,
              indexHitLikely: true,
              estimatedRows: 10,
              usesTempStructure: false,
              usesFilesort: false,
              riskHints: [],
            },
            recommendations: [],
            durationMs: 4,
          };
        },
        async executeReadonly(sql) {
          if (sql.includes("events_statements_history_long")) {
            return {
              queryId: "qry_wait_signal",
              columns: [
                { name: "event_name" },
                { name: "sample_count" },
                { name: "statement_count" },
                { name: "total_wait_ms" },
                { name: "avg_wait_ms" },
              ],
              rows: item.waitEventName
                ? [[item.waitEventName, 4, 2, 160, 40]]
                : [],
              rowCount: item.waitEventName ? 1 : 0,
              originalRowCount: item.waitEventName ? 1 : 0,
              truncated: false,
              rowTruncated: false,
              columnTruncated: false,
              fieldTruncated: false,
              redactedColumns: [],
              droppedColumns: [],
              truncatedColumns: [],
              durationMs: 3,
            };
          }
          return {
            queryId: "qry_digest_signal",
            columns: [
              { name: "schema_name" },
              { name: "digest" },
              { name: "digest_text" },
              { name: "query_sample_text" },
              { name: "exec_count" },
              { name: "avg_latency_ms" },
              { name: "total_latency_ms" },
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
                `digest_${item.name.replace(/\s/g, "_")}`,
                "SELECT * FROM orders WHERE id = ?",
                "SELECT * FROM orders WHERE id = 7",
                10,
                30,
                300,
                80,
                0,
                10,
                0,
                item.avgTmpDiskTables > 0 ? 1 : 0,
                item.avgTmpDiskTables,
                0,
                0,
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
            durationMs: 4,
          };
        },
      },
      confirmationStore: {},
      capabilityProbe: makeCapabilityProbe(),
    });

    const result = await engine.diagnoseSlowQuery(
      { sql: "SELECT * FROM orders WHERE id = 42", maxCandidates: 5 },
      ctx,
    );

    assert.equal(result.status, "ok", item.name);
    assert.equal(
      result.rootCauseCandidates.some(
        (candidate) => candidate.code === item.expectedCode,
      ),
      true,
      item.name,
    );
    assert.equal(result.severity, "warning", item.name);
  }
});

test("engine lets strong runtime evidence outrank weaker plan signals", async () => {
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
          queryId: "qry_runtime_rank",
          plan: [],
          riskSummary: {
            fullTableScanLikely: false,
            indexHitLikely: false,
            estimatedRows: 500,
            usesTempStructure: false,
            usesFilesort: false,
            riskHints: [],
          },
          recommendations: [],
          durationMs: 4,
        };
      },
      async executeReadonly(sql) {
        if (sql.includes("events_statements_history_long")) {
          return {
            queryId: "qry_runtime_wait_rank",
            columns: [
              { name: "event_name" },
              { name: "sample_count" },
              { name: "statement_count" },
              { name: "total_wait_ms" },
              { name: "avg_wait_ms" },
            ],
            rows: [["wait/lock/metadata/sql/mdl", 8, 3, 260, 32.5]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 3,
          };
        }
        return {
          queryId: "qry_runtime_digest_rank",
          columns: [
            { name: "schema_name" },
            { name: "digest" },
            { name: "digest_text" },
            { name: "query_sample_text" },
            { name: "exec_count" },
            { name: "avg_latency_ms" },
            { name: "total_latency_ms" },
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
              "digest_runtime_rank",
              "SELECT * FROM orders WHERE id = ?",
              "SELECT * FROM orders WHERE id = 7",
              10,
              30,
              300,
              80,
              0,
              10,
              0,
              0,
              0,
              0,
              0,
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
          durationMs: 4,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
  });

  const result = await engine.diagnoseSlowQuery(
    { sql: "SELECT * FROM orders WHERE id = 42", maxCandidates: 5 },
    ctx,
  );

  assert.equal(
    result.rootCauseCandidates[0].code,
    "slow_query_wait_event_lock_contention",
  );
  assert.equal(
    result.rootCauseCandidates.some(
      (candidate) => candidate.code === "slow_query_poor_index_usage",
    ),
    true,
  );
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
          rawRef:
            "taurus_api:/v3/project/instances/instance/slow-logs/statistics",
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
  assert.ok(
    result.evidence.some((item) => item.source === "taurus_api_slow_logs"),
  );
  assert.ok(
    result.evidence.some(
      (item) =>
        item.source === "taurus_api_slow_logs" &&
        /avg_lock_time_ms=18.2/.test(item.summary),
    ),
  );
  assert.ok(
    result.rootCauseCandidates.some(
      (candidate) => candidate.code === "slow_query_lock_wait_pressure",
    ),
  );
  assert.ok(
    result.suspiciousEntities.sqls.some(
      (entry) => entry.sqlHash === "sql_hash_external_1",
    ),
  );
});

test("engine merges external Taurus slow-SQL ranking into top slow SQL discovery", async () => {
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
      async executeReadonly() {
        throw new Error("digest unavailable");
      },
      async explain() {
        throw new Error("not used");
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
    slowSqlSource: {
      async resolve() {
        return undefined;
      },
      async findTop() {
        return [
          {
            source: "taurus_api_slow_logs",
            sql: "SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC",
            sqlHash: "sql_hash_top_1",
            digestText: "SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC",
            avgLatencyMs: 180,
            avgLockTimeMs: 22,
            avgRowsExamined: 30000,
            execCount: 8,
            rawRef: "taurus_api:/v3/project/instances/instance/slow-logs/statistics",
          },
        ];
      },
    },
  });

  const result = await engine.findTopSlowSql(
    { topN: 5, sortBy: "total_latency" },
    ctx,
  );

  assert.equal(result.status, "ok");
  assert.equal(result.topSqls[0].sqlHash, "sql_hash_top_1");
  assert.equal(
    result.topSqls[0].evidenceSources.includes("taurus_api_slow_logs"),
    true,
  );
  assert.equal(
    result.evidence.some((item) => item.source === "taurus_api_slow_logs"),
    true,
  );
});

test("engine merges CES metrics into TaurusDB diagnostics", async () => {
  const ctx = makeContext();
  const metricCalls = [];
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
      async executeReadonly(sql) {
        if (/SHOW (REPLICA|SLAVE) STATUS/.test(sql)) {
          return {
            queryId: "qry_replica_status_1",
            columns: [
              { name: "Channel_Name" },
              { name: "Replica_IO_Running" },
              { name: "Replica_SQL_Running" },
              { name: "Seconds_Behind_Source" },
              { name: "Last_IO_Error" },
              { name: "Last_SQL_Error" },
            ],
            rows: [["", "Yes", "Yes", 180, "", ""]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 3,
          };
        }
        return {
          queryId: "qry_empty_1",
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
          durationMs: 1,
        };
      },
    },
    confirmationStore: {},
    capabilityProbe: makeCapabilityProbe(),
    metricsSource: {
      async query(input) {
        metricCalls.push(input.aliases);
        return input.aliases.map((alias) => ({
          alias,
          metricName: `gaussdb_${alias}`,
          points: [
            { timestamp: 1, value: 10 },
            {
              timestamp: 2,
              value:
                alias === "replication_delay"
                  ? 180
                  : alias === "connection_usage"
                    ? 91
                    : alias === "storage_write_delay"
                      ? 120
                      : alias === "cpu_util"
                        ? 88
                        : 20,
            },
          ],
          latest:
            alias === "replication_delay"
              ? 180
              : alias === "connection_usage"
                ? 91
                : alias === "storage_write_delay"
                  ? 120
                  : alias === "cpu_util"
                    ? 88
                    : 20,
          max:
            alias === "replication_delay"
              ? 180
              : alias === "connection_usage"
                ? 91
                : alias === "storage_write_delay"
                  ? 120
                  : alias === "cpu_util"
                    ? 88
                    : 20,
          min: 10,
          avg: 55,
        }));
      },
    },
  });

  const replicationLag = await engine.diagnoseReplicationLag(
    { timeRange: { relative: "30m" } },
    ctx,
  );
  const connectionSpike = await engine.diagnoseConnectionSpike(
    { compareBaseline: true },
    ctx,
  );
  const storagePressure = await engine.diagnoseStoragePressure(
    { scope: "instance" },
    ctx,
  );
  const serviceLatency = await engine.diagnoseServiceLatency(
    { symptom: "cpu" },
    ctx,
  );

  assert.equal(replicationLag.status, "ok");
  assert.equal(
    replicationLag.rootCauseCandidates.some(
      (candidate) => candidate.code === "replication_lag_delay_confirmed",
    ),
    true,
  );
  assert.equal(
    replicationLag.evidence.some((item) => item.source === "ces_metrics"),
    true,
  );
  assert.equal(
    replicationLag.recommendedNextTools.includes("diagnose_db_hotspot"),
    true,
  );
  assert.equal(
    replicationLag.nextToolInputs.some(
      (item) =>
        item.tool === "diagnose_db_hotspot" &&
        item.input.scope === "session",
    ),
    true,
  );

  assert.equal(
    connectionSpike.rootCauseCandidates.some(
      (candidate) =>
        candidate.code === "connection_spike_ces_connection_pressure",
    ),
    true,
  );
  assert.equal(
    connectionSpike.evidence.some((item) => item.source === "ces_metrics"),
    true,
  );

  assert.equal(
    storagePressure.rootCauseCandidates.some(
      (candidate) => candidate.code === "storage_pressure_ces_io_latency",
    ),
    true,
  );
  assert.equal(
    storagePressure.evidence.some((item) => item.source === "ces_metrics"),
    true,
  );
  assert.equal(
    storagePressure.recommendedNextTools.includes("find_top_slow_sql"),
    true,
  );
  assert.equal(
    storagePressure.nextToolInputs.some(
      (item) => item.tool === "find_top_slow_sql",
    ),
    true,
  );

  assert.equal(
    serviceLatency.recommendedNextTools.includes("diagnose_storage_pressure"),
    true,
  );
  assert.equal(
    serviceLatency.evidence.some((item) => item.source === "ces_metrics"),
    true,
  );
  assert.equal(metricCalls.length >= 4, true);
});

test("engine delegates context, schema, guardrail, and executor methods", async () => {
  const ctx = makeContext();
  const expectedDatabases = [{ name: "demo" }];
  const expectedTables = [{ database: "demo", name: "users" }];
  const expectedSchema = {
    database: "demo",
    table: "users",
    columns: [],
    indexes: [],
  };
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
    flashback_query: {
      available: true,
      enabled: true,
      minVersion: "2.0.69.250900",
    },
    parallel_query: {
      available: true,
      enabled: false,
      param: "force_parallel_execute=OFF",
    },
    ndp_pushdown: { available: true, enabled: true, mode: "REPLICA_ON" },
    offset_pushdown: { available: true, enabled: true },
    recycle_bin: {
      available: true,
      enabled: true,
      minVersion: "2.0.57.240900",
    },
    statement_outline: {
      available: true,
      enabled: false,
      minVersion: "2.0.42.230600",
    },
    column_compression: { available: true, minVersion: "2.0.54.240600" },
    multi_tenant: {
      available: true,
      enabled: false,
      active: false,
      minVersion: "2.0.54.240600",
    },
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
        blockedReason:
          "parallel_query is available but force_parallel_execute is disabled.",
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

  assert.equal(
    await engine.resolveContext({ datasource: "local_mysql" }, "task_001"),
    ctx,
  );
  assert.equal(await engine.listDatabases(ctx), expectedDatabases);
  assert.equal(await engine.listTables(ctx, "demo"), expectedTables);
  assert.equal(
    await engine.describeTable(ctx, "demo", "users"),
    expectedSchema,
  );
  assert.equal(
    await engine.inspectSql({
      toolName: "execute_readonly_sql",
      sql: "SELECT 1",
      context: ctx,
    }),
    expectedDecision,
  );
  assert.equal(await engine.explain("SELECT 1", ctx), expectedExplain);
  assert.equal(
    await engine.executeReadonly("SELECT 1", ctx, { maxRows: 10 }),
    expectedReadonly,
  );
  assert.equal(
    await engine.showProcesslist(
      { user: "app_user", includeInfo: true, maxRows: 10 },
      ctx,
    ),
    expectedReadonly,
  );
  assert.equal(
    await engine.showLockWaits(
      { table: "orders", includeSql: true, maxRows: 10 },
      ctx,
    ),
    expectedReadonly,
  );
  assert.equal(
    await engine.executeMutation(
      "UPDATE users SET x = 1",
      makeContext({ limits: { ...ctx.limits, readonly: false } }),
      { timeoutMs: 2000 },
    ),
    expectedMutation,
  );
  assert.equal(await engine.getQueryStatus("qry_2"), expectedStatus);
  assert.equal(await engine.cancelQuery("qry_2"), expectedCancel);
  assert.deepEqual(
    await engine.probeCapabilities(ctx),
    expectedCapabilitySnapshot,
  );
  assert.equal(await engine.getKernelInfo(ctx), expectedKernelInfo);
  assert.equal(await engine.listFeatures(ctx), expectedFeatures);
  assert.deepEqual(
    await engine.explainEnhanced("SELECT 1", ctx),
    expectedEnhancedExplain,
  );

  assert.equal(calls.length, 17);
  assert.deepEqual(calls[0], [
    "resolveContext",
    { datasource: "local_mysql" },
    "task_001",
  ]);
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
