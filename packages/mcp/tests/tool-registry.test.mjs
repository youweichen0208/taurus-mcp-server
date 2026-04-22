import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "@huaweicloud/taurusdb-core";
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
      "execute_readonly_sql",
      "explain_sql",
      "get_kernel_info",
      "list_taurus_features",
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

test("tool registry registers execute_sql only when mutations are enabled", () => {
  const disabled = createLegacyToolServerRecorder();
  registerTools(disabled.server, { pingResponse: "pong" }, createConfigFromEnv({}));
  assert.equal(disabled.calls.some((call) => call.name === "execute_sql"), false);

  const enabled = createLegacyToolServerRecorder();
  registerTools(
    enabled.server,
    { pingResponse: "pong" },
    createConfigFromEnv({ TAURUSDB_MCP_ENABLE_MUTATIONS: "true" }),
  );
  assert.equal(enabled.calls.some((call) => call.name === "execute_sql"), true);
});

test("tool registry registers TaurusDB-specific tools based on startup probe", () => {
  const { server, calls } = createLegacyToolServerRecorder();

  registerTools(
    server,
    { pingResponse: "pong" },
    createConfigFromEnv({}),
    {
      kernelInfo: {
        isTaurusDB: true,
        kernelVersion: "2.0.69.250900",
        mysqlCompat: "8.0",
        rawVersion: "8.0.32 TaurusDB 2.0.69.250900",
      },
      features: {
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
      },
    },
  );

  assert.equal(calls.some((call) => call.name === "explain_sql_enhanced"), true);
  assert.equal(calls.some((call) => call.name === "flashback_query"), true);
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

  const result = await calls[0].handler({});
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
});

test("tool registry skips hidden tools and wraps unhandled errors", async () => {
  const { server, calls } = createLegacyToolServerRecorder();
  const config = createConfigFromEnv({});
  const tools = [
    {
      name: "hidden_tool",
      description: "hidden",
      inputSchema: {},
      exposeWhen: () => false,
      async handler(_input, _deps, context) {
        return {
          ok: true,
          summary: "hidden",
          metadata: { task_id: context.taskId },
        };
      },
    },
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
  assert.match(result.structuredContent.error.message, /boom/);
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
});
