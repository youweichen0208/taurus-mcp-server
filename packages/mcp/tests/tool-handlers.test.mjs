import assert from "node:assert/strict";
import test from "node:test";

import { ErrorCode } from "../dist/utils/formatter.js";
import {
  cancelQueryTool,
  executeReadonlySqlTool,
  executeSqlTool,
  explainSqlTool,
  getQueryStatusTool,
} from "../dist/tools/query.js";
import {
  describeTableTool,
  listDataSourcesTool,
  sampleRowsTool,
} from "../dist/tools/discovery.js";
import {
  getKernelInfoTool,
  listTaurusFeaturesTool,
} from "../dist/tools/taurus/capability.js";
import { explainSqlEnhancedTool } from "../dist/tools/taurus/explain.js";
import { flashbackQueryTool } from "../dist/tools/taurus/flashback.js";

function createDeps(engineOverrides = {}) {
  return {
    config: { enableMutations: true },
    pingResponse: "pong",
    engine: {
      listDataSources: async () => [],
      getDefaultDataSource: async () => undefined,
      resolveContext: async (input, taskId) => ({
        task_id: taskId,
        datasource: input.datasource ?? "main",
        engine: "mysql",
        database: input.database,
        schema: input.schema,
        limits: {
          readonly: input.readonly ?? true,
          timeoutMs: input.timeout_ms ?? 30_000,
          maxRows: 100,
          maxColumns: 50,
          maxFieldChars: 256,
        },
      }),
      listDatabases: async () => [],
      listTables: async () => [],
      describeTable: async () => ({
        database: "app",
        table: "orders",
        columns: [],
        indexes: [],
      }),
      sampleRows: async () => ({
        database: "app",
        table: "orders",
        columns: [{ name: "id" }],
        rows: [[1]],
        sampleSize: 1,
      }),
      inspectSql: async () => ({
        action: "allow",
        riskLevel: "low",
        reasonCodes: [],
        riskHints: [],
        normalizedSql: "SELECT 1",
        sqlHash: "sql_hash_1",
        requiresExplain: false,
        requiresConfirmation: false,
        runtimeLimits: {
          readonly: true,
          timeoutMs: 30_000,
          maxRows: 100,
          maxColumns: 50,
          maxFieldChars: 256,
        },
      }),
      validateConfirmation: async () => ({
        valid: true,
        action: "allow",
        riskLevel: "low",
        reasonCodes: [],
        riskHints: [],
      }),
      handleConfirmation: async () => ({ status: "confirmed" }),
      getKernelInfo: async () => ({
        isTaurusDB: true,
        kernelVersion: "2.0.69.250900",
        mysqlCompat: "8.0",
        instanceSpecHint: "large",
        rawVersion: "8.0.32 TaurusDB 2.0.69.250900",
      }),
      listFeatures: async () => ({
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
      }),
      explainEnhanced: async () => ({
        standardPlan: {
          queryId: "qry_explain_plus_1",
          plan: [{ table: "orders", Extra: "Using pushed NDP condition" }],
          riskSummary: {
            fullTableScanLikely: false,
            indexHitLikely: true,
            estimatedRows: 10,
            usesTempStructure: false,
            usesFilesort: false,
            riskHints: [],
          },
          recommendations: [],
          durationMs: 11,
        },
        taurusHints: {
          ndpPushdown: {
            condition: true,
            columns: false,
            aggregate: false,
          },
          parallelQuery: {
            wouldEnable: false,
            blockedReason: "parallel_query is available but force_parallel_execute is disabled.",
          },
          offsetPushdown: true,
        },
        optimizationSuggestions: ["parallel_query is available but disabled."],
      }),
      executeReadonly: async () => ({
        queryId: "qry_ro_1",
        columns: [{ name: "id" }],
        rows: [[1]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 12,
      }),
      explain: async () => ({
        queryId: "qry_explain_1",
        plan: [{ table: "orders" }],
        riskSummary: {
          fullTableScanLikely: false,
          indexHitLikely: true,
          estimatedRows: 10,
          usesTempStructure: false,
          usesFilesort: false,
          riskHints: [],
        },
        recommendations: [],
        durationMs: 9,
      }),
      executeMutation: async () => ({
        queryId: "qry_rw_1",
        affectedRows: 3,
        durationMs: 20,
      }),
      flashbackQuery: async () => ({
        queryId: "qry_flashback_1",
        columns: [{ name: "id" }],
        rows: [[1]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 7,
      }),
      getQueryStatus: async (queryId) => ({ queryId, status: "completed", durationMs: 10 }),
      cancelQuery: async (queryId) => ({ queryId, status: "cancelled" }),
      ...engineOverrides,
    },
  };
}

const context = { taskId: "task_test_1" };

test("list_data_sources returns public datasource metadata", async () => {
  const deps = createDeps({
    listDataSources: async () => [
      {
        name: "main",
        engine: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "app",
        hasMutationUser: true,
        poolSize: 8,
        isDefault: true,
      },
    ],
    getDefaultDataSource: async () => "main",
  });

  const result = await listDataSourcesTool.handler({}, deps, context);
  assert.equal(result.ok, true);
  assert.equal(result.data.default_datasource, "main");
  assert.deepEqual(result.data.items[0], {
    name: "main",
    engine: "mysql",
    host: "127.0.0.1",
    port: 3306,
    database: "app",
    has_mutation_user: true,
    pool_size: 8,
    is_default: true,
  });
});

test("describe_table validates required database context", async () => {
  const deps = createDeps({
    resolveContext: async (_input, taskId) => ({
      task_id: taskId,
      datasource: "main",
      engine: "mysql",
      limits: {
        readonly: true,
        timeoutMs: 30_000,
        maxRows: 100,
        maxColumns: 50,
        maxFieldChars: 256,
      },
    }),
  });

  const result = await describeTableTool.handler({ table: "orders" }, deps, context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.SQL_SYNTAX_ERROR);
  assert.match(result.error.message, /Missing database/);
});

test("sample_rows applies default sample size and public field mapping", async () => {
  let capturedN;
  const deps = createDeps({
    sampleRows: async (_ctx, database, table, n) => {
      capturedN = n;
      return {
        database,
        table,
        columns: [{ name: "id", type: "bigint" }],
        rows: [[1]],
        redactedColumns: ["email"],
        truncatedColumns: [],
        sampleSize: 1,
        truncated: false,
        totalRowCount: 200,
      };
    },
  });

  const result = await sampleRowsTool.handler({ database: "app", table: "orders" }, deps, context);
  assert.equal(result.ok, true);
  assert.equal(capturedN, 5);
  assert.equal(result.data.sample_size, 1);
  assert.deepEqual(result.data.redacted_columns, ["email"]);
  assert.equal(result.data.total_row_count, 200);
});

test("execute_readonly_sql returns blocked response when guardrail blocks SQL", async () => {
  const deps = createDeps({
    inspectSql: async () => ({
      action: "block",
      riskLevel: "blocked",
      reasonCodes: ["R001"],
      riskHints: ["Multi-statement SQL is blocked."],
      normalizedSql: "SELECT 1; DELETE FROM orders",
      sqlHash: "sql_hash_blocked",
      requiresExplain: false,
      requiresConfirmation: false,
      runtimeLimits: {
        readonly: true,
        timeoutMs: 30_000,
        maxRows: 100,
        maxColumns: 50,
        maxFieldChars: 256,
      },
    }),
  });

  const result = await executeReadonlySqlTool.handler({ sql: "SELECT 1; DELETE FROM orders" }, deps, context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.BLOCKED_SQL);
  assert.equal(result.metadata.sql_hash, "sql_hash_blocked");
});

test("execute_readonly_sql returns confirmation_required when token is missing", async () => {
  const deps = createDeps({
    inspectSql: async () => ({
      action: "confirm",
      riskLevel: "high",
      reasonCodes: ["R006"],
      riskHints: ["Mutation SQL with WHERE requires confirmation."],
      normalizedSql: "DELETE FROM orders WHERE id = ?",
      sqlHash: "sql_hash_confirm",
      requiresExplain: true,
      requiresConfirmation: true,
      runtimeLimits: {
        readonly: false,
        timeoutMs: 30_000,
        maxRows: 100,
        maxColumns: 50,
        maxFieldChars: 256,
      },
    }),
    handleConfirmation: async () => ({
      status: "token_issued",
      token: "ctok_123",
      issuedAt: 1,
      expiresAt: 2,
    }),
  });

  const result = await executeReadonlySqlTool.handler({ sql: "DELETE FROM orders WHERE id = 1" }, deps, context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.CONFIRMATION_REQUIRED);
  assert.equal(result.data.confirmation_token, "ctok_123");
  assert.equal(result.data.sql_hash, "sql_hash_confirm");
});

test("execute_readonly_sql executes when confirmation token validates", async () => {
  const calls = [];
  const deps = createDeps({
    inspectSql: async () => ({
      action: "confirm",
      riskLevel: "high",
      reasonCodes: ["R006"],
      riskHints: ["Mutation SQL with WHERE requires confirmation."],
      normalizedSql: "SELECT * FROM orders",
      sqlHash: "sql_hash_validated",
      requiresExplain: true,
      requiresConfirmation: true,
      runtimeLimits: {
        readonly: true,
        timeoutMs: 5_000,
        maxRows: 10,
        maxColumns: 5,
        maxFieldChars: 32,
      },
    }),
    validateConfirmation: async (token, sql) => {
      calls.push({ token, sql });
      return {
        valid: true,
        action: "allow",
        riskLevel: "low",
        reasonCodes: [],
        riskHints: [],
      };
    },
    executeReadonly: async (_sql, _ctx, opts) => ({
      queryId: "qry_ro_confirmed",
      columns: [{ name: "id" }],
      rows: [[1]],
      rowCount: 1,
      originalRowCount: 1,
      truncated: false,
      rowTruncated: false,
      columnTruncated: false,
      fieldTruncated: false,
      redactedColumns: [],
      droppedColumns: [],
      truncatedColumns: [],
      durationMs: opts.timeoutMs,
    }),
  });

  const result = await executeReadonlySqlTool.handler(
    { sql: "SELECT * FROM orders", confirmation_token: "ctok_ok" },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ token: "ctok_ok", sql: "SELECT * FROM orders" }]);
  assert.equal(result.metadata.query_id, "qry_ro_confirmed");
  assert.equal(result.metadata.duration_ms, 5000);
  assert.equal(result.data.row_count, 1);
});

test("explain_sql returns plan plus guardrail summary", async () => {
  const deps = createDeps({
    inspectSql: async () => ({
      action: "confirm",
      riskLevel: "high",
      reasonCodes: ["R006"],
      riskHints: ["Mutation SQL with WHERE requires confirmation."],
      normalizedSql: "UPDATE orders SET status = 'cancelled' WHERE id = 1",
      sqlHash: "sql_hash_explain",
      requiresExplain: true,
      requiresConfirmation: true,
      runtimeLimits: {
        readonly: true,
        timeoutMs: 30_000,
        maxRows: 100,
        maxColumns: 50,
        maxFieldChars: 256,
      },
    }),
  });

  const result = await explainSqlTool.handler(
    { sql: "UPDATE orders SET status = 'cancelled' WHERE id = 1" },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.guardrail.requires_confirmation, true);
  assert.equal(result.data.risk_summary.index_hit_likely, true);
});

test("Taurus capability tools return kernel info and feature matrix", async () => {
  const deps = createDeps();

  const kernel = await getKernelInfoTool.handler({}, deps, context);
  assert.equal(kernel.ok, true);
  assert.equal(kernel.data.kernel.is_taurusdb, true);
  assert.equal(kernel.data.kernel.kernel_version, "2.0.69.250900");

  const features = await listTaurusFeaturesTool.handler({}, deps, context);
  assert.equal(features.ok, true);
  assert.equal(features.data.features.flashback_query.available, true);
  assert.equal(features.data.features.parallel_query.param, "force_parallel_execute=OFF");
});

test("explain_sql_enhanced returns TaurusDB hints", async () => {
  const deps = createDeps();

  const result = await explainSqlEnhancedTool.handler(
    { sql: "SELECT * FROM orders ORDER BY created_at DESC LIMIT 10 OFFSET 20" },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.standard_plan.guardrail.action, "allow");
  assert.equal(result.data.taurus_hints.ndp_pushdown.condition, true);
  assert.equal(result.data.taurus_hints.offset_pushdown, true);
});

test("flashback_query returns structured readonly result", async () => {
  const deps = createDeps();

  const result = await flashbackQueryTool.handler(
    {
      database: "app",
      table: "orders",
      as_of: { relative: "5m" },
      where: "status = 'paid'",
      limit: 5,
    },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.database, "app");
  assert.equal(result.data.table, "orders");
  assert.equal(result.data.row_count, 1);
});

test("get_query_status and cancel_query adapt query lifecycle responses", async () => {
  const deps = createDeps({
    getQueryStatus: async (queryId) => ({
      queryId,
      status: "running",
      taskId: "task_x",
      datasource: "main",
      mode: "ro",
      startedAt: 10,
      endedAt: undefined,
      durationMs: 55,
      error: undefined,
    }),
    cancelQuery: async (queryId) => ({
      queryId,
      status: "cancelled",
      message: undefined,
    }),
  });

  const status = await getQueryStatusTool.handler({ query_id: "qry_42" }, deps, context);
  assert.equal(status.ok, true);
  assert.equal(status.data.query_id, "qry_42");
  assert.equal(status.data.task_id, "task_x");
  assert.equal(status.data.duration_ms, 55);

  const cancel = await cancelQueryTool.handler({ query_id: "qry_42" }, deps, context);
  assert.equal(cancel.ok, true);
  assert.equal(cancel.data.query_id, "qry_42");
  assert.equal(cancel.data.status, "cancelled");
});

test("execute_sql returns confirmation_invalid when token validation fails", async () => {
  const deps = createDeps({
    inspectSql: async () => ({
      action: "confirm",
      riskLevel: "high",
      reasonCodes: ["R006"],
      riskHints: ["Mutation SQL with WHERE requires confirmation."],
      normalizedSql: "DELETE FROM orders WHERE id = 1",
      sqlHash: "sql_hash_mutation",
      requiresExplain: true,
      requiresConfirmation: true,
      runtimeLimits: {
        readonly: false,
        timeoutMs: 30_000,
        maxRows: 100,
        maxColumns: 50,
        maxFieldChars: 256,
      },
    }),
    validateConfirmation: async () => ({
      valid: false,
      action: "block",
      riskLevel: "blocked",
      reason: "token expired",
      reasonCodes: ["CF002"],
      riskHints: ["token expired"],
    }),
  });

  const result = await executeSqlTool.handler(
    { sql: "DELETE FROM orders WHERE id = 1", confirmation_token: "ctok_bad" },
    deps,
    context,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.CONFIRMATION_INVALID);
  assert.match(result.error.message, /token expired/);
});
