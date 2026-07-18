import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntrypoint = path.resolve(__dirname, "../dist/index.js");
const auditLogPath = path.join(os.tmpdir(), `taurusdb-mcp-stdio-audit-${process.pid}.jsonl`);

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
      TAURUSDB_MCP_AUDIT_LOG_PATH: auditLogPath,
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
      "show_processlist",
      "execute_readonly_sql",
      "explain_sql",
      "get_kernel_info",
      "list_taurus_features",
      "get_session_binding",
      "list_cloud_taurus_instances",
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

    const stderrOutput = stderr.read();
    assert.match(stderrOutput, /Starting MCP server/);
    assert.match(stderrOutput, /Tool invocation started/);
  } finally {
    await transport.close();
  }
});

test("stdio transport hides execute_sql by default", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: path.resolve(__dirname, "../../.."),
    stderr: "pipe",
    env: {
      TAURUSDB_MCP_LOG_LEVEL: "error",
      TAURUSDB_MCP_AUDIT_LOG_PATH: auditLogPath,
    },
  });
  const client = new Client({
    name: "taurusdb-mcp-stdio-test-mutations",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "execute_sql"), false);
  } finally {
    await transport.close();
  }
});

test("stdio transport exposes execute_sql only when mutations are enabled", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-approval-"));
  const approvalSecretPath = path.join(tempDir, "secret");
  await writeFile(
    approvalSecretPath,
    "stdio-test-approval-secret-that-is-at-least-32-bytes\n",
    { encoding: "utf8", mode: 0o600 },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: path.resolve(__dirname, "../../.."),
    stderr: "pipe",
    env: {
      TAURUSDB_MCP_LOG_LEVEL: "error",
      TAURUSDB_MCP_AUDIT_LOG_PATH: auditLogPath,
      TAURUSDB_ENABLE_MUTATIONS: "true",
      TAURUSDB_MUTATION_APPROVAL_SECRET_FILE: approvalSecretPath,
    },
  });
  const client = new Client({ name: "taurusdb-mcp-stdio-test-mutations", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "execute_sql"), true);
  } finally {
    await transport.close();
  }
});
