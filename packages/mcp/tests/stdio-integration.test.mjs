import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntrypoint = path.resolve(__dirname, "../dist/index.js");

function collectStderr(stream) {
  if (!stream) {
    return { read: () => "" };
  }

  let output = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
  });

  return {
    read: () => output,
  };
}

test("stdio transport exposes expected tools and keeps logs on stderr", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: path.resolve(__dirname, "../../.."),
    stderr: "pipe",
    env: {
      TAURUSDB_MCP_LOG_LEVEL: "info",
    },
  });
  const stderr = collectStderr(transport.stderr);
  const client = new Client({
    name: "taurusdb-mcp-stdio-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.deepEqual(toolNames, [
      "ping",
      "list_data_sources",
      "list_databases",
      "list_tables",
      "describe_table",
      "execute_readonly_sql",
      "explain_sql",
      "get_kernel_info",
      "list_taurus_features",
    ]);

    const ping = await client.callTool({
      name: "ping",
      arguments: {},
    });
    assert.equal(ping.isError, false);
    assert.equal(ping.structuredContent.ok, true);
    assert.equal(ping.structuredContent.summary, "pong");
    assert.equal(ping.structuredContent.data.value, "pong");
    assert.match(ping.structuredContent.metadata.task_id, /^task_/);

    const listDataSources = await client.callTool({
      name: "list_data_sources",
      arguments: {},
    });
    assert.equal(listDataSources.isError, false);
    assert.equal(listDataSources.structuredContent.ok, true);
    assert.deepEqual(listDataSources.structuredContent.data.items, []);

    const stderrOutput = stderr.read();
    assert.match(stderrOutput, /Starting MCP server/);
    assert.match(stderrOutput, /Tool invocation started/);
  } finally {
    await transport.close();
  }
});

test("stdio transport exposes execute_sql when mutations are enabled", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: path.resolve(__dirname, "../../.."),
    stderr: "pipe",
    env: {
      TAURUSDB_MCP_ENABLE_MUTATIONS: "true",
      TAURUSDB_MCP_LOG_LEVEL: "error",
    },
  });
  const client = new Client({
    name: "taurusdb-mcp-stdio-test-mutations",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "execute_sql"), true);
  } finally {
    await transport.close();
  }
});
