import assert from "node:assert/strict";
import test from "node:test";

import { ErrorCode } from "../dist/utils/formatter.js";
import {
  executeReadonlySqlTool,
  executeSqlTool,
  explainSqlTool,
} from "../dist/tools/query.js";
import {
  describeTableTool,
  listDataSourcesTool,
} from "../dist/tools/discovery.js";
import { showProcesslistTool } from "../dist/tools/processlist.js";
import {
  getKernelInfoTool,
  listTaurusFeaturesTool,
} from "../dist/tools/taurus/capability.js";
import {
  diagnoseDbHotspotTool,
  diagnoseServiceLatencyTool,
  findTopSlowSqlTool,
  diagnoseConnectionSpikeTool,
  diagnoseLockContentionTool,
  diagnoseReplicationLagTool,
  diagnoseSlowQueryTool,
  diagnoseStoragePressureTool,
} from "../dist/tools/taurus/diagnostics.js";
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
      showProcesslist: async () => ({
        queryId: "qry_processlist_1",
        columns: [{ name: "session_id" }, { name: "user" }, { name: "time_seconds" }],
        rows: [[101, "app_user", 55]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 18,
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
      diagnoseSlowQuery: async (input) => ({
        tool: "diagnose_slow_query",
        status: input.sql ? "ok" : "inconclusive",
        severity: input.sql ? "warning" : "info",
        summary: input.sql
          ? "slow query diagnosis collected explain evidence"
          : `slow query placeholder for ${input.sqlHash ?? "unknown"}`,
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [
          {
            code: input.sql
              ? "slow_query_full_table_scan"
              : "diagnose_slow_query_pending",
            title: input.sql ? "full scan" : "pending",
            confidence: "low",
            rationale: input.sql ? "explain evidence" : "pending",
          },
        ],
        keyFindings: [input.sql ? "explain evidence collected" : "pending"],
        suspiciousEntities: {
          sqls: [{
            sqlHash: input.sqlHash,
            digestText: input.digestText,
            reason: input.sql ? "explain-backed" : "focus",
          }],
        },
        evidence: [{
          source: input.sql ? "explain" : "diagnostics_scaffold",
          title: "pending",
          summary: input.sql ? "live explain" : "pending",
        }],
        recommendedActions: [input.sql ? "review indexes" : "implement it"],
        limitations: [input.sql ? "runtime correlation pending" : "pending"],
      }),
      diagnoseServiceLatency: async (input) => ({
        tool: "diagnose_service_latency",
        status: "ok",
        summary: "service latency points to slow sql",
        diagnosisWindow: { relative: "15m" },
        suspectedCategory: input.symptom === "connection_growth" ? "connection_spike" : "slow_sql",
        topCandidates: [{
          type: input.symptom === "connection_growth" ? "session" : "sql",
          title:
            input.symptom === "connection_growth"
              ? "Connection growth around user app_user"
              : "Top ranked SQL digest: SELECT * FROM orders ORDER BY created_at DESC",
          confidence: "high",
          sqlHash: input.symptom === "connection_growth" ? undefined : "sql_hash_1",
          digestText:
            input.symptom === "connection_growth"
              ? undefined
              : "SELECT * FROM orders ORDER BY created_at DESC",
          sampleSql:
            input.symptom === "connection_growth"
              ? undefined
              : "SELECT * FROM orders ORDER BY created_at DESC",
          sessionId: input.symptom === "connection_growth" ? "101" : undefined,
          rationale: "aggregated symptom routing result",
        }],
        evidence: [{ source: "statement_digest", title: "ranking", summary: "ranking" }],
        recommendedNextTools:
          input.symptom === "connection_growth"
            ? ["diagnose_connection_spike", "show_processlist"]
            : ["diagnose_slow_query"],
        nextToolInputs:
          input.symptom === "connection_growth"
            ? [{
                tool: "diagnose_connection_spike",
                input: { user: "app_user", compare_baseline: false },
                rationale: "inspect connection growth",
              }]
            : [{
                tool: "diagnose_slow_query",
                input: { sql: "SELECT * FROM orders ORDER BY created_at DESC" },
                rationale: "analyze top sql",
              }],
        limitations: ["first version"],
      }),
      diagnoseDbHotspot: async (input) => ({
        tool: "diagnose_db_hotspot",
        status: "ok",
        summary: "database hotspot points to sql",
        diagnosisWindow: { relative: "15m" },
        scope: input.scope ?? "all",
        hotspots: [{
          type: input.scope === "session" ? "session" : "sql",
          title:
            input.scope === "session"
              ? "Connection hotspot around session 101"
              : "Top SQL hotspot: SELECT * FROM orders ORDER BY created_at DESC",
          confidence: "high",
          sqlHash: input.scope === "session" ? undefined : "sql_hash_1",
          digestText:
            input.scope === "session"
              ? undefined
              : "SELECT * FROM orders ORDER BY created_at DESC",
          sampleSql:
            input.scope === "session"
              ? undefined
              : "SELECT * FROM orders ORDER BY created_at DESC",
          sessionId: input.scope === "session" ? "101" : undefined,
          rationale: "aggregated hotspot result",
          evidenceSources: [input.scope === "session" ? "processlist" : "statement_digest"],
          recommendation: "follow next tool",
        }],
        evidence: [{ source: "statement_digest", title: "ranking", summary: "ranking" }],
        recommendedNextTools:
          input.scope === "session"
            ? ["diagnose_connection_spike", "show_processlist"]
            : ["diagnose_slow_query"],
        nextToolInputs:
          input.scope === "session"
            ? [{
                tool: "show_processlist",
                input: { include_idle: true, include_info: true, max_rows: 20 },
                rationale: "review live sessions",
              }]
            : [{
                tool: "diagnose_slow_query",
                input: { sql: "SELECT * FROM orders ORDER BY created_at DESC" },
                rationale: "analyze hotspot sql",
              }],
        limitations: ["first version"],
      }),
      findTopSlowSql: async () => ({
        tool: "find_top_slow_sql",
        status: "ok",
        summary: "top slow sql found",
        diagnosisWindow: { relative: "15m" },
        topSqls: [{
          sqlHash: "sql_hash_1",
          digestText: "SELECT * FROM orders ORDER BY created_at DESC",
          sampleSql: "SELECT * FROM orders ORDER BY created_at DESC",
          avgLatencyMs: 87.5,
          totalLatencyMs: 1050,
          execCount: 12,
          avgLockTimeMs: 25,
          avgRowsExamined: 50000,
          evidenceSources: ["statement_digest"],
          recommendation: "Run diagnose_slow_query with sql or digest_text to analyze the dominant bottleneck.",
        }],
        evidence: [{ source: "statement_digest", title: "ranking", summary: "ranking" }],
        limitations: ["digest-only first version"],
      }),
      diagnoseConnectionSpike: async (input) => ({
        tool: "diagnose_connection_spike",
        status: "inconclusive",
        severity: "info",
        summary: "connection spike placeholder",
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [{ code: "pending", title: "pending", confidence: "low", rationale: "pending" }],
        keyFindings: ["pending"],
        suspiciousEntities: input.user
          ? { users: [{ user: input.user, clientHost: input.clientHost, reason: "focus" }] }
          : undefined,
        evidence: [{ source: "diagnostics_scaffold", title: "pending", summary: "pending" }],
        recommendedActions: ["implement it"],
        limitations: ["pending"],
      }),
      diagnoseLockContention: async (input) => ({
        tool: "diagnose_lock_contention",
        status: "inconclusive",
        severity: "info",
        summary: "lock placeholder",
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [{ code: "pending", title: "pending", confidence: "low", rationale: "pending" }],
        keyFindings: ["pending"],
        suspiciousEntities: input.table ? { tables: [{ table: input.table, reason: "focus" }] } : undefined,
        evidence: [{ source: "diagnostics_scaffold", title: "pending", summary: "pending" }],
        recommendedActions: ["implement it"],
        limitations: ["pending"],
      }),
      diagnoseReplicationLag: async (input) => ({
        tool: "diagnose_replication_lag",
        status: "not_applicable",
        severity: "info",
        summary: "replication placeholder",
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [{ code: "pending", title: "pending", confidence: "low", rationale: "pending" }],
        keyFindings: [input.replicaId ?? "pending"],
        evidence: [{ source: "diagnostics_scaffold", title: "pending", summary: "pending" }],
        recommendedActions: ["implement it"],
        limitations: ["pending"],
      }),
      diagnoseStoragePressure: async (input) => ({
        tool: "diagnose_storage_pressure",
        status: "inconclusive",
        severity: "info",
        summary: "storage placeholder",
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [{ code: "pending", title: "pending", confidence: "low", rationale: "pending" }],
        keyFindings: [input.scope ?? "instance"],
        suspiciousEntities: input.table ? { tables: [{ table: input.table, reason: "focus" }] } : undefined,
        evidence: [{ source: "diagnostics_scaffold", title: "pending", summary: "pending" }],
        recommendedActions: ["implement it"],
        limitations: ["pending"],
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

test("show_processlist passes sanitized filters to engine.showProcesslist", async () => {
  let capturedInput;
  const deps = createDeps({
    showProcesslist: async (input) => {
      capturedInput = input;
      return {
        queryId: "qry_processlist_1",
        columns: [{ name: "session_id" }, { name: "user" }, { name: "time_seconds" }],
        rows: [[101, "app_user", 55]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 18,
      };
    },
  });

  const result = await showProcesslistTool.handler(
    {
      user: "app_user",
      host: "10.0.0.8",
      min_time_seconds: 30,
      include_info: true,
      max_rows: 10,
      info_max_chars: 512,
    },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.datasource, "main");
  assert.equal(result.data.row_count, 1);
  assert.equal(result.metadata.duration_ms, 18);
  assert.deepEqual(capturedInput, {
    user: "app_user",
    host: "10.0.0.8",
    sessionDatabase: undefined,
    command: undefined,
    minTimeSeconds: 30,
    maxRows: 10,
    includeIdle: false,
    includeSystem: false,
    includeInfo: true,
    infoMaxChars: 512,
  });
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

test("diagnose_slow_query validates that at least one SQL identifier is provided", async () => {
  const result = await diagnoseSlowQueryTool.handler({}, createDeps(), context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.SQL_SYNTAX_ERROR);
  assert.match(result.error.message, /sql, sql_hash, or digest_text/);
});

test("diagnostic tool handlers return structured diagnostic payloads", async () => {
  const deps = createDeps();

  const serviceLatency = await diagnoseServiceLatencyTool.handler(
    { symptom: "latency", user: "app_user" },
    deps,
    context,
  );
  assert.equal(serviceLatency.ok, true);
  assert.equal(serviceLatency.data.tool, "diagnose_service_latency");
  assert.equal(serviceLatency.data.suspected_category, "slow_sql");
  assert.equal(serviceLatency.data.top_candidates[0].type, "sql");
  assert.equal(serviceLatency.data.next_tool_inputs[0].tool, "diagnose_slow_query");
  assert.equal(serviceLatency.data.next_tool_inputs[0].input.sql, "SELECT * FROM orders ORDER BY created_at DESC");
  assert.equal(serviceLatency.data.recommended_next_tools[0], "diagnose_slow_query");

  const dbHotspot = await diagnoseDbHotspotTool.handler(
    { scope: "session" },
    deps,
    context,
  );
  assert.equal(dbHotspot.ok, true);
  assert.equal(dbHotspot.data.tool, "diagnose_db_hotspot");
  assert.equal(dbHotspot.data.scope, "session");
  assert.equal(dbHotspot.data.hotspots[0].type, "session");
  assert.equal(dbHotspot.data.next_tool_inputs[0].tool, "show_processlist");
  assert.equal(dbHotspot.data.next_tool_inputs[0].input.include_idle, true);
  assert.equal(dbHotspot.data.recommended_next_tools.includes("diagnose_connection_spike"), true);

  const topSlowSql = await findTopSlowSqlTool.handler(
    { top_n: 5, sort_by: "total_latency" },
    deps,
    context,
  );
  assert.equal(topSlowSql.ok, true);
  assert.equal(topSlowSql.data.tool, "find_top_slow_sql");
  assert.equal(topSlowSql.data.top_sqls[0].digest_text, "SELECT * FROM orders ORDER BY created_at DESC");
  assert.equal(topSlowSql.data.top_sqls[0].evidence_sources[0], "statement_digest");

  const slowQuery = await diagnoseSlowQueryTool.handler({ sql_hash: "sql_hash_1" }, deps, context);
  assert.equal(slowQuery.ok, true);
  assert.equal(slowQuery.data.tool, "diagnose_slow_query");
  assert.equal(slowQuery.data.suspicious_entities.sqls[0].sql_hash, "sql_hash_1");

  const slowQueryWithSql = await diagnoseSlowQueryTool.handler(
    { sql: "SELECT * FROM orders ORDER BY created_at DESC" },
    deps,
    context,
  );
  assert.equal(slowQueryWithSql.ok, true);
  assert.equal(slowQueryWithSql.data.tool, "diagnose_slow_query");
  assert.equal(slowQueryWithSql.data.status, "ok");
  assert.equal(slowQueryWithSql.data.evidence[0].source, "explain");

  const connectionSpike = await diagnoseConnectionSpikeTool.handler(
    { user: "app_user", client_host: "10.0.0.8", compare_baseline: true },
    deps,
    context,
  );
  assert.equal(connectionSpike.ok, true);
  assert.equal(connectionSpike.data.tool, "diagnose_connection_spike");
  assert.equal(connectionSpike.data.suspicious_entities.users[0].client_host, "10.0.0.8");

  const lockContention = await diagnoseLockContentionTool.handler(
    { table: "orders", blocker_session_id: "123" },
    deps,
    context,
  );
  assert.equal(lockContention.ok, true);
  assert.equal(lockContention.data.tool, "diagnose_lock_contention");
  assert.equal(lockContention.data.suspicious_entities.tables[0].table, "orders");

  const replicationLag = await diagnoseReplicationLagTool.handler(
    { replica_id: "replica-1", channel: "default" },
    deps,
    context,
  );
  assert.equal(replicationLag.ok, true);
  assert.equal(replicationLag.data.tool, "diagnose_replication_lag");
  assert.equal(replicationLag.data.status, "not_applicable");

  const storagePressure = await diagnoseStoragePressureTool.handler(
    { scope: "table", table: "orders" },
    deps,
    context,
  );
  assert.equal(storagePressure.ok, true);
  assert.equal(storagePressure.data.tool, "diagnose_storage_pressure");
  assert.equal(storagePressure.data.key_findings[0], "table");
});
