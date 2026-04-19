import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "../dist/config/index.js";
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

test("tool registry registers default tools through legacy tool API", async () => {
  const { server, calls } = createLegacyToolServerRecorder();

  registerTools(
    server,
    { pingResponse: "pong" },
    createConfigFromEnv({}),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "ping");
  assert.equal(calls[0].description.includes("pong"), true);
  assert.deepEqual(calls[0].inputSchema, {});

  const result = await calls[0].handler({});
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.summary, "pong");
  assert.equal(result.structuredContent.data.value, "pong");
  assert.match(result.structuredContent.metadata.task_id, /^task_/);
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
