import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv, FlashbackNoViewError, UnsupportedFeatureError } from "taurusdb-core";
import { ErrorCode } from "../dist/utils/formatter.js";
import {
  analyzeMutationSqlTool,
  executeReadonlySqlTool,
  explainSqlTool,
} from "../dist/tools/query.js";
import {
  describeTableTool,
} from "../dist/tools/discovery.js";
import { showProcesslistTool } from "../dist/tools/processlist.js";
import {
  getKernelInfoTool,
  listTaurusFeaturesTool,
} from "../dist/tools/taurus/capability.js";
import { listCloudTaurusInstancesTool } from "../dist/tools/taurus/cloud-instances.js";
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
import {
  clearSqlCredentialsTool,
  getSessionBindingTool,
  selectCloudTaurusInstanceTool,
  setDefaultDatabaseTool,
} from "../dist/tools/taurus/cloud-context.js";
import { beginSqlLoginTool } from "../dist/tools/taurus/sql-login.js";
import { DatabaseEndpointPreflightError } from "../dist/security/database-endpoint-preflight.js";
import {
  getRecycleBinRestoreStatusTool,
  listRecycleBinTool,
  prepareRecycleBinRestoreTool,
} from "../dist/tools/taurus/recycle-bin.js";

function createDeps(engineOverrides = {}) {
  const runtimeTargets = new Map();
  const profiles = new Map([
    [
      "taurus_mcp",
      {
        name: "taurus_mcp",
        engine: "mysql",
        host: undefined,
        port: 3306,
        database: "app",
        user: {
          username: "app",
          password: { type: "plain", value: "pwd" },
        },
        toString() {
          return "{}";
        },
      },
    ],
  ]);
  return {
    config: createConfigFromEnv({
      TAURUSDB_CLOUD_REGION: "cn-north-4",
      TAURUSDB_CLOUD_AUTH_TOKEN: "token-1",
    }),
    profileLoader: {
      async load() {
        return new Map(profiles);
      },
      async getDefault() {
        return "taurus_mcp";
      },
      async get(name) {
        const profile = profiles.get(name);
        const target = runtimeTargets.get(name);
        return profile && target ? { ...profile, ...target } : profile;
      },
      setRuntimeTarget(name, target) {
        const current = runtimeTargets.get(name) ?? {};
        runtimeTargets.set(name, {
          ...current,
          ...target,
        });
      },
      clearRuntimeUser(name) {
        const current = runtimeTargets.get(name);
        if (!current) {
          return;
        }
        const { user, ...next } = current;
        runtimeTargets.set(name, next);
      },
      clearRuntimeTarget(name) {
        runtimeTargets.delete(name);
      },
      clearAllRuntimeTargets() {
        runtimeTargets.clear();
      },
      getRuntimeTarget(name) {
        return runtimeTargets.get(name);
      },
    },
    pingResponse: "pong",
    endpointPreflight: async () => {},
    credentialLogin: {
      async issueSqlLogin() {
        return {
          loginUrl: "http://127.0.0.1:12345/sql-login/token",
          expiresAt: "2026-06-07T01:00:00.000Z",
        };
      },
      async close() {},
    },
    sqlCredentialValidator: async () => {},
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
      listDatabases: async () => [{ name: "app" }, { name: "analytics" }],
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
        flashback_query: {
          available: true,
          enabled: true,
          minVersion: "2.0.69.250900",
          param: "innodb_rds_backquery_enable=ON",
        },
        parallel_query: { available: true, enabled: false, param: "force_parallel_execute=OFF" },
        ndp_pushdown: {
          available: true,
          enabled: true,
          mode: "REPLICA_ON",
          param: "ndp_mode=REPLICA_ON",
        },
        offset_pushdown: {
          available: true,
          enabled: true,
          param: "optimizer_switch: offset_pushdown=on",
        },
        recycle_bin: {
          available: true,
          enabled: true,
          minVersion: "2.0.57.240900",
          param: "rds_recycle_bin_mode=ON",
        },
        statement_outline: {
          available: true,
          enabled: false,
          minVersion: "2.0.42.230600",
          param: "rds_opt_outline_enabled=OFF",
        },
        column_compression: { available: true, minVersion: "2.0.54.240600" },
        multi_tenant: {
          available: true,
          enabled: false,
          active: false,
          minVersion: "2.0.54.240600",
          param: "rds_multi_tenant=OFF",
        },
        partition_mdl: {
          available: true,
          enabled: false,
          minVersion: "2.0.57.240900",
          param: "rds_partition_level_mdl_enabled=OFF",
        },
        dynamic_masking: {
          available: true,
          enabled: false,
          minVersion: "2.0.69.250900",
          param: "rds_dynamic_masking_enabled=OFF",
        },
        nonblocking_ddl: {
          available: true,
          enabled: false,
          minVersion: "2.0.54.240600",
          param: "rds_nonblock_ddl_enable=OFF",
        },
        hot_row_update: {
          available: true,
          enabled: false,
          minVersion: "2.0.54.240600",
          param: "rds_hotspot=OFF",
        },
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
        featureExplanations: {
          ndpPushdown: {
            matched: true,
            meaning: "NDP meaning",
            whyTriggered: "NDP triggered",
            expectedBenefit: "NDP benefit",
          },
          parallelQuery: {
            matched: false,
            meaning: "PQ meaning",
            whyTriggered: "PQ blocked",
            expectedBenefit: "PQ benefit",
          },
          offsetPushdown: {
            matched: true,
            meaning: "OFFSET meaning",
            whyTriggered: "OFFSET triggered",
            expectedBenefit: "OFFSET benefit",
          },
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
      listRecycleBin: async () => ({
        queryId: "qry_recycle_1",
        columns: [{ name: "TABLE_NAME" }],
        rows: [["orders@123"]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 8,
      }),
      restoreRecycleBinTable: async () => ({
        queryId: "qry_restore_1",
        affectedRows: 1,
        durationMs: 21,
      }),
      issueConfirmation: async () => ({
        request: "creq_restore_1",
        requestId: "restore-1",
        issuedAt: 1,
        expiresAt: 301,
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
      diagnoseReplicationLag: async () => ({
        tool: "diagnose_replication_lag",
        status: "not_applicable",
        severity: "info",
        summary: "no replica channel",
        diagnosisWindow: { relative: "15m" },
        rootCauseCandidates: [],
        keyFindings: ["no channel"],
        evidence: [],
        recommendedActions: ["select a replica endpoint"],
        limitations: ["point-in-time"],
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
        recommendedNextTools: ["diagnose_slow_query"],
        nextToolInputs: [{
          tool: "diagnose_slow_query",
          input: { sql: "SELECT * FROM orders ORDER BY created_at DESC" },
          rationale: "inspect lead digest",
        }],
        limitations: ["pending"],
      }),
      getQueryStatus: async (queryId) => ({ queryId, status: "completed", durationMs: 10 }),
      cancelQuery: async (queryId) => ({ queryId, status: "cancelled" }),
      ...engineOverrides,
    },
  };
}

const context = { taskId: "task_test_1" };

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
  assert.equal(result.error.code, ErrorCode.INVALID_INPUT);
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

test("execute_readonly_sql returns an external approval request when approval is missing", async () => {
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
      status: "approval_required",
      request: "creq_123",
      requestId: "request-123",
      issuedAt: 1,
      expiresAt: 2,
    }),
  });

  const result = await executeReadonlySqlTool.handler({ sql: "DELETE FROM orders WHERE id = 1" }, deps, context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.CONFIRMATION_REQUIRED);
  assert.equal(result.data.approval_request, "creq_123");
  assert.equal(result.data.request_id, "request-123");
  assert.equal(result.data.sql_hash, "sql_hash_confirm");
});

test("execute_readonly_sql executes when an external approval token validates", async () => {
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
    { sql: "SELECT * FROM orders", approval_token: "ctok_ok" },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ token: "ctok_ok", sql: "SELECT * FROM orders" }]);
  assert.equal(result.metadata.duration_ms, 5000);
  assert.equal(result.data.row_count, 1);
});

test("query tools execute the normalized SQL inspected by guardrail", async () => {
  const executed = [];
  const normalizedSql = "SELECT 1";
  const deps = createDeps({
    inspectSql: async () => ({
      action: "allow",
      riskLevel: "low",
      reasonCodes: [],
      riskHints: [],
      normalizedSql,
      sqlHash: "sql_hash_normalized",
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
    executeReadonly: async (sql) => {
      executed.push(["readonly", sql]);
      return {
        queryId: "qry_normalized",
        columns: [{ name: "value" }],
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
        durationMs: 1,
      };
    },
    explain: async (sql) => {
      executed.push(["explain", sql]);
      return {
        queryId: "qry_explain_normalized",
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
        durationMs: 1,
      };
    },
  });

  await executeReadonlySqlTool.handler({ sql: "SELECT 1 /*! executable comment */" }, deps, context);
  await explainSqlTool.handler({ sql: "SELECT 1 /*! executable comment */" }, deps, context);

  assert.deepEqual(executed, [
    [
      "readonly",
      normalizedSql,
    ],
    ["explain", normalizedSql],
  ]);
});

test("execute_readonly_sql hides unexpected driver error details", async () => {
  const deps = createDeps({
    executeReadonly: async () => {
      throw new Error("internal table secret_orders does not exist");
    },
  });

  const result = await executeReadonlySqlTool.handler({ sql: "SELECT 1" }, deps, context);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.CONNECTION_FAILED);
  assert.equal(result.error.message, "execute_readonly_sql failed unexpectedly.");
  assert.doesNotMatch(result.error.message, /secret_orders/);
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
  assert.equal(
    features.data.features.flashback_query.param,
    "innodb_rds_backquery_enable=ON",
  );
  assert.equal(features.data.features.parallel_query.param, "force_parallel_execute=OFF");
  assert.equal(features.data.features.ndp_pushdown.param, "ndp_mode=REPLICA_ON");
  assert.equal(
    features.data.features.offset_pushdown.param,
    "optimizer_switch: offset_pushdown=on",
  );
  assert.equal(features.data.features.recycle_bin.param, "rds_recycle_bin_mode=ON");
  assert.equal(
    features.data.features.dynamic_masking.param,
    "rds_dynamic_masking_enabled=OFF",
  );
  assert.equal(
    features.data.features.nonblocking_ddl.param,
    "rds_nonblock_ddl_enable=OFF",
  );
  assert.equal("statement_outline" in features.data.features, false);
  assert.equal("column_compression" in features.data.features, false);
  assert.equal("multi_tenant" in features.data.features, false);
  assert.equal("partition_mdl" in features.data.features, false);
  assert.equal("hot_row_update" in features.data.features, false);
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
  assert.equal(result.data.feature_explanations.offset_pushdown.matched, true);
  assert.equal(
    result.data.feature_explanations.offset_pushdown.why_triggered,
    "OFFSET triggered",
  );
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

test("flashback_query surfaces contextual diagnostics when no view is available", async () => {
  const deps = createDeps({
    flashbackQuery: async () => {
      throw new FlashbackNoViewError(
        "No view available for provided TIMESTAMP.",
        {
          requested_timestamp: "2026-05-13 11:04:39",
          current_time: "2026-05-13 11:10:00",
          backquery_window_seconds: 3600,
          current_row_updated_at: "2026-05-13 11:04:39",
          recommended_timestamps: [
            "2026-05-13 11:04:38",
            "2026-05-13 11:04:34",
          ],
        },
      );
    },
  });

  const result = await flashbackQueryTool.handler(
    {
      database: "app",
      table: "orders",
      as_of: { timestamp: "2026-05-13 11:04:39" },
      where: "id = 1",
      limit: 1,
    },
    deps,
    context,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.CONNECTION_FAILED);
  assert.equal(
    result.summary,
    "No historical flashback view was available for the requested timestamp.",
  );
  assert.deepEqual(result.error.details.recommended_timestamps, [
    "2026-05-13 11:04:38",
    "2026-05-13 11:04:34",
  ]);
});

test("list_recycle_bin returns structured readonly result", async () => {
  const deps = createDeps();

  const result = await listRecycleBinTool.handler({}, deps, context);

  assert.equal(result.ok, true);
  assert.equal(result.data.datasource, "main");
  assert.equal(result.data.row_count, 1);
  assert.equal(result.data.rows[0][0], "orders@123");
});

test("list_recycle_bin returns parameter hint when TaurusDB feature is disabled", async () => {
  const deps = createDeps({
    listRecycleBin: async () => {
      throw new UnsupportedFeatureError(
        "recycle_bin",
        "Recycle bin is available but disabled on this instance.",
        {
          currentVersion: "2.0.69.250900",
          parameterHint: "rds_recycle_bin_mode=ON",
        },
      );
    },
  });

  const result = await listRecycleBinTool.handler({}, deps, context);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.UNSUPPORTED_FEATURE);
  assert.equal(result.error.details.parameter_hint, "rds_recycle_bin_mode=ON");
});

test("prepare_recycle_bin_restore performs readonly preflight and cannot execute from the Agent tool call", async () => {
  const deps = createDeps();
  deps.config = createConfigFromEnv({
    TAURUSDB_CLOUD_REGION: "cn-north-4",
    TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE: "true",
  });
  let issuedRequest;
  let restoreCalls = 0;
  const auditEvents = [];
  deps.recoveryApproval = {
    async issue(request) {
      issuedRequest = request;
      return {
        requestId: "rrq_restore_1",
        approvalUrl: "http://127.0.0.1:12345/recovery/token",
        expiresAt: "2026-07-20T06:00:00.000Z",
      };
    },
    getStatus() { return undefined; },
    async close() {},
  };
  deps.engine.listTables = async () => restoreCalls === 0
    ? []
    : [{ name: "orders_restored" }];
  deps.engine.restoreRecycleBinTable = async () => {
    restoreCalls += 1;
    return { queryId: "qry_restore_1", affectedRows: 1, durationMs: 4 };
  };
  deps.auditWriter = {
    async write(event) { auditEvents.push(event); },
    async close() {},
  };

  const prepared = await prepareRecycleBinRestoreTool.handler({
    datasource: "taurus_mcp",
    recycle_table: "orders@123",
    destination_database: "app",
    destination_table: "orders_restored",
  }, deps, { taskId: "task_prepare_restore" });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.data.status, "pending");
  assert.equal(prepared.data.agent_can_execute, false);
  assert.equal("confirmation_text" in prepared.data, false);
  assert.equal(restoreCalls, 0);
  assert.ok(issuedRequest);

  const executed = await issuedRequest.execute("operator@example.com", "rrq_restore_1");
  assert.equal(restoreCalls, 1);
  assert.equal(executed.verified, true);
  assert.deepEqual(auditEvents.map((event) => event.tool), [
    "approve_recycle_bin_restore",
    "restore_recycle_bin_table",
  ]);
  assert.equal(auditEvents[1].actor, "operator@example.com");
});

test("prepare_recycle_bin_restore fails closed on destination collision", async () => {
  const deps = createDeps();
  deps.config = createConfigFromEnv({ TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE: "true" });
  let issued = false;
  deps.recoveryApproval = {
    async issue() { issued = true; throw new Error("must not issue"); },
    getStatus() { return undefined; },
    async close() {},
  };
  deps.auditWriter = { async write() {}, async close() {} };
  deps.engine.listTables = async () => [{ name: "orders_restored" }];
  const result = await prepareRecycleBinRestoreTool.handler({
    datasource: "taurus_mcp",
    recycle_table: "orders@123",
    destination_database: "app",
    destination_table: "orders_restored",
  }, deps, { taskId: "task_collision" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.INVALID_INPUT);
  assert.match(result.error.message, /already exists/);
  assert.equal(issued, false);
});

test("approved recycle-bin recovery fails closed when the datasource target changes", async () => {
  const deps = createDeps();
  deps.config = createConfigFromEnv({ TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE: "true" });
  let issuedRequest;
  let restoreCalls = 0;
  const auditEvents = [];
  deps.recoveryApproval = {
    async issue(request) {
      issuedRequest = request;
      return {
        requestId: "rrq_target_change",
        approvalUrl: "http://127.0.0.1:12345/recovery/token",
        expiresAt: "2026-07-20T06:00:00.000Z",
      };
    },
    getStatus() { return undefined; },
    async close() {},
  };
  deps.auditWriter = {
    async write(event) { auditEvents.push(event); },
    async close() {},
  };
  deps.engine.listTables = async () => [];
  deps.engine.restoreRecycleBinTable = async () => {
    restoreCalls += 1;
    return { queryId: "must_not_run", affectedRows: 1, durationMs: 1 };
  };
  const prepared = await prepareRecycleBinRestoreTool.handler({
    datasource: "taurus_mcp",
    recycle_table: "orders@123",
    destination_database: "app",
    destination_table: "orders_restored",
  }, deps, { taskId: "task_prepare_target" });
  assert.equal(prepared.ok, true);

  deps.engine.resolveContext = async (input, taskId) => ({
    task_id: taskId,
    datasource: input.datasource ?? "taurus_mcp",
    engine: "mysql",
    database: input.database,
    host: "changed.example.internal",
    port: 3306,
    limits: {
      readonly: input.readonly ?? true,
      timeoutMs: input.timeout_ms ?? 30_000,
      maxRows: 100,
      maxColumns: 50,
      maxFieldChars: 256,
    },
  });
  await assert.rejects(
    () => issuedRequest.execute("operator@example.com", "rrq_target_change"),
    /target changed/,
  );
  assert.equal(restoreCalls, 0);
  assert.equal(auditEvents.at(-1).tool, "approve_recycle_bin_restore");
  assert.equal(auditEvents.at(-1).outcome, "error");
});

test("get_recycle_bin_restore_status returns operator-attributed verified result", async () => {
  const deps = createDeps();
  deps.recoveryApproval = {
    async issue() { throw new Error("not used"); },
    getStatus() {
      return {
        requestId: "rrq_1",
        status: "succeeded",
        target: {
          datasource: "taurus_mcp",
          recycleTable: "orders@123",
          destinationDatabase: "app",
          destinationTable: "orders_restored",
        },
        createdAt: "2026-07-20T05:00:00.000Z",
        expiresAt: "2026-07-20T05:05:00.000Z",
        operator: "operator@example.com",
        completedAt: "2026-07-20T05:01:00.000Z",
        result: { queryId: "qry_restore", affectedRows: 1, verified: true },
      };
    },
    async close() {},
  };
  const result = await getRecycleBinRestoreStatusTool.handler(
    { request_id: "rrq_1" },
    deps,
    { taskId: "task_status" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "succeeded");
  assert.equal(result.data.operator, "operator@example.com");
  assert.equal(result.data.result.verified, true);
});

test("set_default_database binds a session-scoped default database after instance selection", async () => {
  let schemaProbe;
  const deps = createDeps({
    listTables: async (ctx, database) => {
      schemaProbe = { ctx, database };
      return [];
    },
  });

  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    instanceId: "instance-1",
    nodeId: "node-1",
  });

  const result = await setDefaultDatabaseTool.handler(
    {
      datasource: "taurus_mcp",
      database: "analytics",
    },
    deps,
    { taskId: "task_set_default_database" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.datasource, "taurus_mcp");
  assert.equal(result.data.database, "analytics");
  assert.equal(schemaProbe.database, "analytics");
  assert.equal(schemaProbe.ctx.database, "analytics");
  assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
    host: "1.2.3.4",
    port: 3306,
    database: "analytics",
    instanceId: "instance-1",
    nodeId: "node-1",
  });
});

test("begin_sql_login returns a secure local URL without credential fields", async () => {
  const deps = createDeps({
    getDefaultDataSource: async () => "taurus_mcp",
  });
  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    instanceId: "instance-1",
  });

  const result = await beginSqlLoginTool.handler(
    {},
    deps,
    { taskId: "task_begin_sql_login" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    datasource: "taurus_mcp",
    login_url: "http://127.0.0.1:12345/sql-login/token",
    expires_at: "2026-06-07T01:00:00.000Z",
  });
  assert.equal(Object.hasOwn(result.data, "username"), false);
  assert.equal(Object.hasOwn(result.data, "password"), false);
});

test("begin_sql_login binds submitted credentials and rebuilds the engine", async () => {
  let pendingLogin;
  let closed = false;
  let validated = false;
  let activatedDatasource;
  let expiration;
  const deps = createDeps({
    getDefaultDataSource: async () => "taurus_mcp",
    close: async () => {
      closed = true;
    },
  });
  deps.credentialLogin = {
    async issueSqlLogin(request) {
      pendingLogin = request;
      return {
        loginUrl: "http://127.0.0.1:12345/sql-login/token",
        expiresAt: "2026-06-07T01:00:00.000Z",
      };
    },
    async close() {},
  };
  deps.sqlCredentialValidator = async () => {
    validated = true;
  };
  deps.credentialSessions = {
    activate(datasource, onExpire) {
      activatedDatasource = datasource;
      expiration = onExpire;
    },
  };
  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    instanceId: "instance-1",
  });

  const result = await beginSqlLoginTool.handler(
    {},
    deps,
    { taskId: "task_begin_sql_login_bind" },
  );
  assert.equal(result.ok, true);
  assert.ok(pendingLogin);

  await pendingLogin.bind({
    datasource: "taurus_mcp",
    username: "session_app",
    password: "session_pwd",
  });

  assert.equal(closed, true);
  assert.equal(validated, true);
  assert.equal(activatedDatasource, "taurus_mcp");
  assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
    host: "1.2.3.4",
    port: 3306,
    database: "app",
    user: {
      username: "session_app",
      password: { type: "plain", value: "session_pwd" },
    },
    instanceId: "instance-1",
    nodeId: undefined,
  });
  await expiration();
  assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
    host: "1.2.3.4",
    port: 3306,
    database: "app",
    instanceId: "instance-1",
    nodeId: undefined,
  });
});

test("begin_sql_login rejects invalid credentials and restores the previous target", async () => {
  let pendingLogin;
  const deps = createDeps({ getDefaultDataSource: async () => "taurus_mcp" });
  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    instanceId: "instance-1",
  });
  deps.credentialLogin = {
    async issueSqlLogin(request) {
      pendingLogin = request;
      return {
        loginUrl: "http://127.0.0.1:12345/sql-login/token",
        expiresAt: "2026-06-07T01:00:00.000Z",
      };
    },
    async close() {},
  };
  deps.sqlCredentialValidator = async () => {
    const error = new Error("access denied for password secret");
    error.code = "ER_ACCESS_DENIED_ERROR";
    throw error;
  };

  const issued = await beginSqlLoginTool.handler({}, deps, { taskId: "task_invalid_login" });
  assert.equal(issued.ok, true);
  await assert.rejects(
    pendingLogin.bind({
      datasource: "taurus_mcp",
      username: "bad_user",
      password: "bad_password",
    }),
    (error) => error?.name === "SqlCredentialValidationError" && error?.kind === "credentials",
  );
  assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
    host: "1.2.3.4",
    port: 3306,
    instanceId: "instance-1",
  });
});

test("begin_sql_login requires a resolved database host", async () => {
  const deps = createDeps({ getDefaultDataSource: async () => "taurus_mcp" });
  const result = await beginSqlLoginTool.handler({}, deps, { taskId: "task_login_without_host" });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /does not define a database host/i);
});

test("clear_sql_credentials restores datasource profile credentials", async () => {
  const deps = createDeps();
  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    database: "analytics",
    user: {
      username: "session_app",
      password: { type: "plain", value: "session_pwd" },
    },
    instanceId: "instance-1",
    nodeId: "node-1",
  });

  const result = await clearSqlCredentialsTool.handler(
    { datasource: "taurus_mcp" },
    deps,
    { taskId: "task_clear_sql_credentials" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.datasource, "taurus_mcp");
  assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
    host: "1.2.3.4",
    port: 3306,
    database: "analytics",
    instanceId: "instance-1",
    nodeId: "node-1",
  });
});

test("get_session_binding returns current runtime binding with masked username", async () => {
  const deps = createDeps();
  deps.profileLoader.setRuntimeTarget("taurus_mcp", {
    host: "1.2.3.4",
    port: 3306,
    database: "analytics",
    user: {
      username: "session_app",
      password: { type: "plain", value: "session_pwd" },
    },
    instanceId: "instance-1",
    nodeId: "node-1",
  });

  const result = await getSessionBindingTool.handler(
    { datasource: "taurus_mcp" },
    deps,
    { taskId: "task_get_session_binding" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.datasource, "taurus_mcp");
  assert.equal(result.data.username_masked, "s***p");
  assert.equal(result.data.runtime_override.instance_id, "instance-1");
  assert.equal(result.data.runtime_override.database, "analytics");
  assert.equal(result.data.runtime_override.has_sql_credentials_override, true);
  assert.equal(result.data.runtime_override.username_masked, "s***p");
});

test("list_cloud_taurus_instances returns structured cloud instance list", async () => {
  const deps = createDeps();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/v3/auth/projects")) {
      return new Response(
        JSON.stringify({
          projects: [{ id: "project-1", name: "cn-north-4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        instances: [
          {
            id: "instance-1",
            name: "prod-taurus",
            status: "normal",
            mode: "Cluster",
            datastore: { version: "8.0" },
            private_ips: ["10.0.0.8"],
            public_ips: ["1.2.3.4"],
            port: "3306",
            created: "2026-04-01T00:00:00Z",
            updated: "2026-04-02T00:00:00Z",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await listCloudTaurusInstancesTool.handler({}, deps, context);

    assert.equal(result.ok, true);
    assert.equal(result.data.total, 1);
    assert.equal(result.data.items[0].id, "instance-1");
    assert.equal(result.data.items[0].name, "prod-taurus");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("select_cloud_taurus_instance binds the public host for local MCP login", async () => {
  const deps = createDeps({
    getDefaultDataSource: async () => "taurus_mcp",
    close: async () => {},
  });
  let loginRequest;
  const revokedOperatorSessions = [];
  const preflightCalls = [];
  deps.endpointPreflight = async (host, port) => { preflightCalls.push({ host, port }); };
  deps.operatorSessions = {
    revokeDatasource(datasource) { revokedOperatorSessions.push(datasource); },
  };
  deps.credentialLogin.issueSqlLogin = async (request) => {
    loginRequest = request;
    return {
      loginUrl: "http://127.0.0.1:12345/sql-login/token",
      expiresAt: "2026-06-07T01:00:00.000Z",
    };
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/v3/auth/projects")) {
      return new Response(
        JSON.stringify({
          projects: [{ id: "project-1", name: "cn-north-4" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        instances: [
          {
            id: "instance-1",
            name: "prod-taurus",
            private_ips: ["10.0.0.8"],
            public_ips: ["1.2.3.4"],
            port: "3306",
            nodes: [{ id: "node-1", role: "master", private_ip: "10.0.0.8" }],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await selectCloudTaurusInstanceTool.handler(
      { instance_id: "instance-1" },
      deps,
      context,
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.bound_datasource, "taurus_mcp");
    assert.equal(result.data.bound_host, "1.2.3.4");
    assert.equal(result.data.login_url, "http://127.0.0.1:12345/sql-login/token");
    assert.equal(result.data.login_expires_at, "2026-06-07T01:00:00.000Z");
    assert.equal(loginRequest.datasource, "taurus_mcp");
    assert.equal(loginRequest.target.instanceId, "instance-1");
    assert.deepEqual(preflightCalls, [{ host: "1.2.3.4", port: 3306 }]);
    assert.deepEqual(revokedOperatorSessions, ["taurus_mcp"]);
    assert.deepEqual(deps.profileLoader.getRuntimeTarget("taurus_mcp"), {
      host: "1.2.3.4",
      port: 3306,
      instanceId: "instance-1",
      nodeId: "node-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("select_cloud_taurus_instance reports an actionable endpoint preflight failure", async () => {
  const deps = createDeps({
    getDefaultDataSource: async () => "taurus_mcp",
    close: async () => {},
  });
  deps.endpointPreflight = async (host, port) => {
    throw new DatabaseEndpointPreflightError("unreachable", host, port);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/v3/auth/projects")) {
      return new Response(JSON.stringify({
        projects: [{ id: "project-1", name: "cn-north-4" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      instances: [{
        id: "instance-1",
        name: "prod-taurus",
        public_ips: ["1.2.3.4"],
        port: "3306",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await selectCloudTaurusInstanceTool.handler(
      { instance_id: "instance-1" },
      deps,
      context,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.DB_ENDPOINT_UNREACHABLE);
    assert.match(result.error.message, /security group's inbound rules/i);
    assert.match(result.error.message, /public egress IP\/32/i);
    assert.equal(deps.profileLoader.getRuntimeTarget("taurus_mcp"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("select_cloud_taurus_instance fails immediately when no public IP exists", async () => {
  const deps = createDeps({
    getDefaultDataSource: async () => "taurus_mcp",
    close: async () => {},
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/v3/auth/projects")) {
      return new Response(JSON.stringify({
        projects: [{ id: "project-1", name: "cn-north-4" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      instances: [{
        id: "instance-private-only",
        name: "private-taurus",
        private_ips: ["10.0.0.8"],
        public_ips: [],
        port: "3306",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await selectCloudTaurusInstanceTool.handler(
      { instance_id: "instance-private-only" },
      deps,
      context,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.INVALID_INPUT);
    assert.match(result.error.message, /does not have a public database IP/i);
    assert.match(result.error.message, /egress IP/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analyze_mutation_sql returns readonly evidence and never executes the mutation", async () => {
  let readonlySql;
  let mutationCalls = 0;
  const deps = createDeps({
    describeTable: async () => ({
      database: "app",
      table: "orders",
      columns: [
        { name: "id", dataType: "bigint", nullable: false },
        { name: "status", dataType: "varchar(32)", nullable: false },
      ],
      indexes: [{ name: "PRIMARY", columns: ["id"], unique: true }],
    }),
    executeReadonly: async (sql) => {
      readonlySql = sql;
      return { queryId: "count", columns: [{ name: "matched_row_count" }], rows: [[2]], rowCount: 1, originalRowCount: 1, truncated: false, rowTruncated: false, columnTruncated: false, fieldTruncated: false, byteTruncated: false, returnedBytes: 8, redactedColumns: [], droppedColumns: [], truncatedColumns: [], durationMs: 1 };
    },
    executeMutation: async () => { mutationCalls += 1; throw new Error("must not be called"); },
  });

  const result = await analyzeMutationSqlTool.handler(
    { database: "app", sql: "UPDATE orders SET status = 'done' WHERE id IN (1, 2)" },
    deps,
    context,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.execution_status, "not_executed");
  assert.match(result.data.advised_sql, /^UPDATE orders SET status/);
  assert.equal(result.data.human_review_required, true);
  assert.equal(result.data.impact_analysis.sample_rows_read, false);
  assert.equal(result.data.impact_analysis.matched_row_count, 2);
  assert.match(readonlySql, /^SELECT COUNT\(\*\).*WHERE id IN \(1, 2\)$/);
  assert.equal(mutationCalls, 0);
});

test("analyze_mutation_sql refuses copy-ready advice for unbounded updates", async () => {
  const result = await analyzeMutationSqlTool.handler(
    { database: "app", sql: "UPDATE orders SET status = 'done'" },
    createDeps(),
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.execution_status, "not_executed");
  assert.equal(result.data.advised_sql, null);
  assert.equal(result.data.risk_findings.some((finding) => /without a WHERE/i.test(finding)), true);
});

test("analyze_mutation_sql does not inspect or advise a cross-database mutation", async () => {
  let databaseCalls = 0;
  const deps = createDeps({
    describeTable: async () => { databaseCalls += 1; throw new Error("must not be called"); },
    explain: async () => { databaseCalls += 1; throw new Error("must not be called"); },
    executeReadonly: async () => { databaseCalls += 1; throw new Error("must not be called"); },
  });
  const result = await analyzeMutationSqlTool.handler(
    { database: "app", sql: "UPDATE other_db.orders SET status = 'done' WHERE id = 1" },
    deps,
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.advised_sql, null);
  assert.equal(result.data.risk_findings.some((finding) => /outside the bound session/i.test(finding)), true);
  assert.equal(databaseCalls, 0);
});

test("analyze_mutation_sql warns on destructive DDL without returning copy-ready SQL", async () => {
  const result = await analyzeMutationSqlTool.handler(
    { database: "app", sql: "DROP TABLE orders" },
    createDeps(),
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.execution_status, "not_executed");
  assert.equal(result.data.advised_sql, null);
  assert.equal(result.data.risk_findings.some((finding) => /outside copy-ready SQL Advice scope/i.test(finding)), true);
});

test("analyze_mutation_sql validates CREATE INDEX against current schema", async () => {
  const deps = createDeps({
    describeTable: async () => ({
      database: "app",
      table: "orders",
      columns: [{ name: "status", dataType: "varchar(32)", nullable: false }],
      indexes: [],
    }),
  });
  const result = await analyzeMutationSqlTool.handler(
    { database: "app", sql: "CREATE INDEX idx_orders_status ON orders(status)" },
    deps,
    context,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.execution_status, "not_executed");
  assert.match(result.data.advised_sql, /^CREATE INDEX/);
  assert.equal(result.data.schema_findings.length, 1);
});

test("diagnose_slow_query validates that at least one SQL identifier is provided", async () => {
  const result = await diagnoseSlowQueryTool.handler({}, createDeps(), context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ErrorCode.INVALID_INPUT);
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
    { channel: "default" },
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
  assert.equal(storagePressure.data.recommended_next_tools[0], "diagnose_slow_query");
  assert.equal(
    storagePressure.data.next_tool_inputs[0].input.sql,
    "SELECT * FROM orders ORDER BY created_at DESC",
  );
});
