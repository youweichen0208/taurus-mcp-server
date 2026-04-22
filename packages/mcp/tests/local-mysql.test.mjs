import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const serverEntrypoint = path.resolve(__dirname, "../dist/index.js");
const schemaSqlPath = path.resolve(repoRoot, "testdata/mysql/local-mysql-schema.sql");
const seedSqlPath = path.resolve(repoRoot, "testdata/mysql/local-mysql-seed.sql");
const runLocalMysqlTests = process.env.TAURUSDB_RUN_LOCAL_MYSQL_TESTS === "true";
const localMysqlTest = runLocalMysqlTests ? test : test.skip;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function parseInteger(value, fallback) {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return Number.parseInt(value, 10);
}

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

function parseBootstrapDsn(dsn) {
  const url = new URL(dsn);
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || undefined,
    multipleStatements: true,
  };
}

async function prepareDatabase() {
  const bootstrapDsn = process.env.TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN;
  if (!bootstrapDsn) {
    return;
  }

  const [schemaSql, seedSql] = await Promise.all([
    readFile(schemaSqlPath, "utf8"),
    readFile(seedSqlPath, "utf8"),
  ]);

  const connection = await mysql.createConnection(parseBootstrapDsn(bootstrapDsn));
  try {
    await connection.query(schemaSql);
    await connection.query(seedSql);
  } finally {
    await connection.end();
  }
}

async function createProfilesFile() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-local-mysql-"));
  const profilesPath = path.join(tempDir, "profiles.json");

  const host = requiredEnv("TAURUSDB_TEST_MYSQL_HOST");
  const port = parseInteger(process.env.TAURUSDB_TEST_MYSQL_PORT, 3306);
  const database = requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE");
  const readonlyUser = requiredEnv("TAURUSDB_TEST_MYSQL_USER");
  const readonlyPassword = requiredEnv("TAURUSDB_TEST_MYSQL_PASSWORD");
  const mutationUser = process.env.TAURUSDB_TEST_MYSQL_MUTATION_USER?.trim() || readonlyUser;
  const mutationPassword = process.env.TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD?.trim() || readonlyPassword;

  const profile = {
    defaultDatasource: "local_mysql_e2e",
    dataSources: {
      local_mysql_e2e: {
        engine: "mysql",
        host,
        port,
        database,
        readonlyUser: {
          username: readonlyUser,
          password: readonlyPassword,
        },
        mutationUser: {
          username: mutationUser,
          password: mutationPassword,
        },
        poolSize: 4,
      },
    },
  };

  await writeFile(profilesPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profilesPath;
}

async function withClient(run) {
  await prepareDatabase();
  const profilesPath = await createProfilesFile();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: repoRoot,
    stderr: "pipe",
    env: {
      TAURUSDB_SQL_PROFILES: profilesPath,
      TAURUSDB_DEFAULT_DATASOURCE: "local_mysql_e2e",
      TAURUSDB_MCP_ENABLE_MUTATIONS: "true",
      TAURUSDB_MCP_LOG_LEVEL: "error",
    },
  });
  const stderr = collectStderr(transport.stderr);
  const client = new Client({
    name: "taurusdb-local-mysql-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    return await run({ client, stderr });
  } finally {
    await transport.close();
  }
}

localMysqlTest("local mysql MCP covers discovery, readonly query, and explain", async () => {
  await withClient(async ({ client, stderr }) => {
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "execute_sql"), true);

    const dataSources = await client.callTool({
      name: "list_data_sources",
      arguments: {},
    });
    assert.equal(dataSources.isError, false);
    assert.equal(dataSources.structuredContent.data.default_datasource, "local_mysql_e2e");
    assert.equal(dataSources.structuredContent.data.items[0].name, "local_mysql_e2e");

    const databases = await client.callTool({
      name: "list_databases",
      arguments: {},
    });
    assert.equal(databases.isError, false);
    assert.equal(
      databases.structuredContent.data.items.some((item) => item.name === requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE")),
      true,
    );

    const tables = await client.callTool({
      name: "list_tables",
      arguments: {
        database: requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE"),
      },
    });
    assert.equal(tables.isError, false);
    assert.deepEqual(
      tables.structuredContent.data.items.map((item) => item.name).sort(),
      ["audit_events", "orders", "payments", "users"],
    );

    const describe = await client.callTool({
      name: "describe_table",
      arguments: {
        database: requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE"),
        table: "orders",
      },
    });
    assert.equal(describe.isError, false);
    assert.equal(describe.structuredContent.data.table, "orders");
    assert.equal(describe.structuredContent.data.primary_key[0], "id");
    assert.equal(describe.structuredContent.data.engine_hints.likely_time_columns.includes("created_at"), true);
    assert.equal(describe.structuredContent.data.indexes.some((index) => index.name === "idx_orders_status_created_at"), true);

    const readonly = await client.callTool({
      name: "execute_readonly_sql",
      arguments: {
        sql: "SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status ORDER BY status",
      },
    });
    assert.equal(readonly.isError, false);
    assert.equal(readonly.structuredContent.ok, true);
    assert.equal(readonly.structuredContent.metadata.statement_type, "select");
    assert.equal(readonly.structuredContent.data.row_count, 3);

    const explain = await client.callTool({
      name: "explain_sql",
      arguments: {
        sql: "SELECT id, status FROM orders WHERE status = 'paid' ORDER BY created_at DESC LIMIT 5",
      },
    });
    assert.equal(explain.isError, false);
    assert.equal(Array.isArray(explain.structuredContent.data.plan), true);
    assert.equal(explain.structuredContent.data.guardrail.action === "allow" || explain.structuredContent.data.guardrail.action === "confirm", true);

    assert.equal(stderr.read().includes('"level":50'), false);
  });
});

localMysqlTest("local mysql MCP covers mutation confirmation flow", async () => {
  await withClient(async ({ client }) => {
    const confirm = await client.callTool({
      name: "execute_sql",
      arguments: {
        sql: "UPDATE orders SET status = 'cancelled' WHERE order_no = 'ORD-1002'",
      },
    });
    assert.equal(confirm.isError, true);
    assert.equal(confirm.structuredContent.error.code, "CONFIRMATION_REQUIRED");
    const token = confirm.structuredContent.data.confirmation_token;
    assert.match(token, /^ctok_/);

    const execute = await client.callTool({
      name: "execute_sql",
      arguments: {
        sql: "UPDATE orders SET status = 'cancelled' WHERE order_no = 'ORD-1002'",
        confirmation_token: token,
      },
    });
    assert.equal(execute.isError, false);
    assert.equal(execute.structuredContent.data.affected_rows, 1);
    assert.equal(execute.structuredContent.metadata.statement_type, "update");

    const reuse = await client.callTool({
      name: "execute_sql",
      arguments: {
        sql: "UPDATE orders SET status = 'cancelled' WHERE order_no = 'ORD-1002'",
        confirmation_token: token,
      },
    });
    assert.equal(reuse.isError, true);
    assert.equal(reuse.structuredContent.error.code, "CONFIRMATION_INVALID");

    const verify = await client.callTool({
      name: "execute_readonly_sql",
      arguments: {
        sql: "SELECT status FROM orders WHERE order_no = 'ORD-1002' LIMIT 1",
      },
    });
    assert.equal(verify.isError, false);
    assert.equal(verify.structuredContent.data.rows[0][0], "cancelled");
  });
});
