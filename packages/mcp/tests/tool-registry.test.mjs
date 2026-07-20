import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "taurusdb-core";
import { registerTools } from "../dist/tools/registry.js";
import { ErrorCode } from "../dist/utils/formatter.js";

function createLegacyToolServerRecorder() {
  const calls = [];
  return {
    calls,
    server: {
      tool(name, description, inputSchema, handler) {
        calls.push({ name, description, inputSchema, handler });
      },
    },
  };
}

function createModernToolServerRecorder() {
  const calls = [];
  return {
    calls,
    server: {
      registerTool(name, config, handler) {
        calls.push({ name, config, handler });
      },
    },
  };
}

test("tool registry registers default MCP tools through legacy tool API", async () => {
  const { server, calls } = createLegacyToolServerRecorder();

  registerTools(
    server,
    { pingResponse: "pong" },
    createConfigFromEnv({}),
  );

  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "ping",
      "list_data_sources",
      "list_databases",
      "list_tables",
      "describe_table",
      "show_processlist",
      "execute_readonly_sql",
      "explain_sql",
      "analyze_mutation_sql",
      "get_kernel_info",
      "list_taurus_features",
      "get_session_binding",
      "list_cloud_taurus_instances",
      "set_cloud_region",
      "begin_sql_login",
      "clear_sql_credentials",
      "set_default_database",
      "select_cloud_taurus_instance",
      "diagnose_service_latency",
      "diagnose_db_hotspot",
      "find_top_slow_sql",
      "diagnose_slow_query",
      "diagnose_connection_spike",
      "diagnose_lock_contention",
      "diagnose_replication_lag",
      "diagnose_storage_pressure",
      "explain_sql_enhanced",
      "flashback_query",
      "list_recycle_bin",
      "prepare_recycle_bin_restore",
      "get_recycle_bin_restore_status",
    ],
  );

  const pingCall = calls.find((call) => call.name === "ping");
  assert.ok(pingCall);
  assert.equal(pingCall.description.includes("pong"), true);
  assert.deepEqual(pingCall.inputSchema, {});

  const result = await pingCall.handler({});
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.summary, "pong");
  assert.equal(result.structuredContent.data.value, "pong");
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
});

test("tool registry exposes interactive instance selection and human-gated recovery by default", () => {
  const recorder = createLegacyToolServerRecorder();
  registerTools(recorder.server, { pingResponse: "pong" }, createConfigFromEnv({}));
  assert.equal(recorder.calls.some((call) => call.name === "execute_sql"), false);
  assert.equal(recorder.calls.some((call) => call.name === "restore_recycle_bin_table"), false);
  assert.equal(recorder.calls.some((call) => call.name === "prepare_recycle_bin_restore"), true);
  assert.equal(recorder.calls.some((call) => call.name === "set_cloud_region"), true);
  assert.equal(recorder.calls.some((call) => call.name === "begin_sql_login"), true);
});

test("tool registry can explicitly disable controlled recovery tools", () => {
  const recorder = createModernToolServerRecorder();
  registerTools(
    recorder.server,
    {},
    createConfigFromEnv({ TAURUSDB_ENABLE_RECYCLE_BIN_RESTORE: "false" }),
  );
  const prepare = recorder.calls.find((call) => call.name === "prepare_recycle_bin_restore");
  const status = recorder.calls.find((call) => call.name === "get_recycle_bin_restore_status");
  assert.equal(prepare, undefined);
  assert.equal(status, undefined);
  assert.equal(recorder.calls.some((call) => call.name === "restore_recycle_bin_table"), false);
  assert.equal(recorder.calls.some((call) => call.name === "execute_sql"), false);
});

test("tool registry never exposes database mutation tools, even with legacy flags", () => {
  const recorder = createLegacyToolServerRecorder();
  registerTools(
    recorder.server,
    { pingResponse: "pong" },
    createConfigFromEnv({
      TAURUSDB_ENABLE_MUTATIONS: "true",
      TAURUSDB_ENABLE_DYNAMIC_TARGETS: "true",
    }),
  );
  assert.equal(recorder.calls.some((call) => call.name === "execute_sql"), false);
  assert.equal(recorder.calls.some((call) => call.name === "restore_recycle_bin_table"), false);
  assert.equal(recorder.calls.some((call) => call.name === "analyze_mutation_sql"), true);
  assert.equal(recorder.calls.some((call) => call.name === "set_cloud_region"), true);
  assert.equal(recorder.calls.some((call) => call.name === "begin_sql_login"), true);
});

test("tool registry registers diagnostics tools by default", () => {
  const enabled = createLegacyToolServerRecorder();
  registerTools(enabled.server, { pingResponse: "pong" }, createConfigFromEnv({}));
  assert.equal(
    enabled.calls.some((call) => call.name === "diagnose_slow_query"),
    true,
  );
});

test("tool registry allows administrators to disable dynamic instance selection", () => {
  const disabled = createLegacyToolServerRecorder();
  registerTools(
    disabled.server,
    { pingResponse: "pong" },
    createConfigFromEnv({ TAURUSDB_ENABLE_DYNAMIC_TARGETS: "false" }),
  );
  assert.equal(
    disabled.calls.some((call) => call.name === "list_cloud_taurus_instances"),
    true,
  );
  assert.equal(
    disabled.calls.some((call) => call.name === "select_cloud_taurus_instance"),
    false,
  );

  const enabled = createLegacyToolServerRecorder();
  registerTools(
    enabled.server,
    { pingResponse: "pong" },
    createConfigFromEnv({
      TAURUSDB_CLOUD_REGION: "cn-north-4",
      TAURUSDB_CLOUD_ACCESS_KEY_ID: "ak-1",
      TAURUSDB_CLOUD_SECRET_ACCESS_KEY: "sk-1",
      TAURUSDB_ENABLE_DYNAMIC_TARGETS: "true",
    }),
  );
  assert.equal(
    enabled.calls.some((call) => call.name === "list_cloud_taurus_instances"),
    true,
  );
  assert.equal(
    enabled.calls.some((call) => call.name === "select_cloud_taurus_instance"),
    true,
  );
});

test("tool registry registers tools through registerTool API when available", async () => {
  const { server, calls } = createModernToolServerRecorder();
  const customTool = {
    name: "custom_tool",
    description: "custom",
    inputSchema: {},
    async handler(_input, _deps, context) {
      return {
        ok: true,
        summary: "ok",
        data: { task_id: context.taskId },
        metadata: { task_id: context.taskId },
      };
    },
  };

  registerTools(server, {}, createConfigFromEnv({}), [customTool]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "custom_tool");
  assert.equal(calls[0].config.description, "custom");
  assert.deepEqual(calls[0].config.inputSchema, {});
  assert.equal(calls[0].config.annotations.readOnlyHint, true);
  assert.ok(calls[0].config.outputSchema.ok);

  const result = await calls[0].handler({});
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
});

test("SQL Advice is registered as readonly and non-destructive", () => {
  const recorder = createModernToolServerRecorder();
  registerTools(recorder.server, {}, createConfigFromEnv({}));
  const advice = recorder.calls.find((call) => call.name === "analyze_mutation_sql");
  assert.ok(advice);
  assert.equal(advice.config.annotations.readOnlyHint, true);
  assert.equal(advice.config.annotations.destructiveHint, false);
});

test("tool registry writes actor and target context to the audit sink", async () => {
  const { server, calls } = createModernToolServerRecorder();
  const events = [];
  const config = createConfigFromEnv({
    TAURUSDB_DEFAULT_DATASOURCE: "prod",
    TAURUSDB_CLOUD_PROJECT_ID: "project-1",
    TAURUSDB_CLOUD_INSTANCE_ID: "instance-1",
  });
  registerTools(
    server,
    {
      config,
      profileLoader: {
        async getDefault() { return "prod"; },
        async get() {
          return {
            name: "prod",
            engine: "mysql",
            host: "10.0.0.8",
            port: 3306,
            database: "orders",
            instanceId: "instance-1",
          };
        },
        getRuntimeTarget() { return undefined; },
      },
      auditWriter: {
        async write(event) { events.push(event); },
        async close() {},
      },
    },
    config,
    [{
      name: "select_cloud_taurus_instance",
      description: "session mutation",
      inputSchema: {},
      async handler(_input, _deps, context) {
        context.approvalActor = "operator@example.com";
        return {
          ok: true,
          summary: "done",
          data: {},
          metadata: {
            task_id: context.taskId,
            sql_hash: "sha256:abc",
          },
        };
      },
    }],
  );
  const result = await calls[0].handler({});
  assert.equal(result.isError, false);
  assert.equal(calls[0].config.annotations.readOnlyHint, false);
  assert.equal(calls[0].config.annotations.destructiveHint, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "operator@example.com");
  assert.equal(events[0].host, "10.0.0.8");
  assert.equal(events[0].instance_id, "instance-1");
  assert.equal(events[0].sql_hash, "sha256:abc");
});

test("tool registry wraps unhandled errors", async () => {
  const { server, calls } = createLegacyToolServerRecorder();
  const config = createConfigFromEnv({});
  const tools = [
    {
      name: "boom_tool",
      description: "boom",
      inputSchema: {},
      async handler() {
        throw new Error("boom");
      },
    },
  ];

  registerTools(server, {}, config, tools);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "boom_tool");

  const result = await calls[0].handler({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.error.code, ErrorCode.CONNECTION_FAILED);
  assert.equal(result.structuredContent.error.message, "Tool execution failed unexpectedly.");
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
});
