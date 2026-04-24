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
const usersSqlPath = path.resolve(repoRoot, "testdata/mysql/local-mysql-users.sql");
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

  const [schemaSql, seedSql, usersSql] = await Promise.all([
    readFile(schemaSqlPath, "utf8"),
    readFile(seedSqlPath, "utf8"),
    readFile(usersSqlPath, "utf8"),
  ]);

  const connection = await mysql.createConnection(parseBootstrapDsn(bootstrapDsn));
  try {
    await connection.query(schemaSql);
    await connection.query(seedSql);
    await connection.query(usersSql);
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

function mysqlConnectionConfig({ mutation = false } = {}) {
  return {
    host: requiredEnv("TAURUSDB_TEST_MYSQL_HOST"),
    port: parseInteger(process.env.TAURUSDB_TEST_MYSQL_PORT, 3306),
    database: requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE"),
    user: requiredEnv(mutation ? "TAURUSDB_TEST_MYSQL_MUTATION_USER" : "TAURUSDB_TEST_MYSQL_USER"),
    password: requiredEnv(
      mutation ? "TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD" : "TAURUSDB_TEST_MYSQL_PASSWORD",
    ),
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function statusValue(rows, name) {
  const row = rows.find((item) => item.Variable_name === name);
  return Number.parseInt(String(row?.Value ?? "0"), 10);
}

async function withBootstrapConnection(run, options = {}) {
  const bootstrapDsn = process.env.TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN;
  if (!bootstrapDsn) {
    throw new Error("Missing required env: TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN");
  }
  const connectionConfig = parseBootstrapDsn(bootstrapDsn);
  const connection = await mysql.createConnection({
    ...connectionConfig,
    database: options.database ?? connectionConfig.database,
  });
  try {
    return await run(connection);
  } finally {
    await connection.end();
  }
}

const storagePressureSql =
  "SELECT category, payload, COUNT(*) AS event_count FROM storage_pressure_events GROUP BY category, payload ORDER BY payload LIMIT 5";

async function prepareStoragePressureFixture() {
  await withBootstrapConnection(async (connection) => {
    await connection.query("DROP TABLE IF EXISTS storage_pressure_events");
    await connection.query(`
      CREATE TABLE storage_pressure_events (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        category VARCHAR(32) NOT NULL,
        payload TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    const rows = [];
    for (let index = 0; index < 500; index += 1) {
      rows.push([
        `cat-${index % 20}`,
        `pressure-payload-${index}-${"x".repeat(2048)}`,
        new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)),
      ]);
    }
    await connection.query(
      "INSERT INTO storage_pressure_events (category, payload, created_at) VALUES ?",
      [rows],
    );
  }, { database: requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE") });
}

async function runStoragePressureWorkload() {
  return withBootstrapConnection(async (connection) => {
    await connection.query("SET SESSION internal_tmp_mem_storage_engine = MEMORY");
    await connection.query("SET SESSION tmp_table_size = 1024");
    await connection.query("SET SESSION max_heap_table_size = 1024");

    const [beforeRows] = await connection.query("SHOW SESSION STATUS LIKE 'Created_tmp_disk_tables'");
    const before = statusValue(beforeRows, "Created_tmp_disk_tables");
    for (let index = 0; index < 3; index += 1) {
      await connection.query(storagePressureSql);
    }
    const [afterRows] = await connection.query("SHOW SESSION STATUS LIKE 'Created_tmp_disk_tables'");
    return statusValue(afterRows, "Created_tmp_disk_tables") - before;
  }, { database: requiredEnv("TAURUSDB_TEST_MYSQL_DATABASE") });
}

async function withClient(run, options = {}) {
  if (options.skipPrepareDatabase !== true) {
    await prepareDatabase();
  }
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

localMysqlTest("local mysql MCP exposes diagnostics tools by default", async () => {
  await withClient(async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    assert.equal(toolNames.includes("diagnose_service_latency"), true);
    assert.equal(toolNames.includes("diagnose_db_hotspot"), true);
    assert.equal(toolNames.includes("find_top_slow_sql"), true);
    assert.equal(toolNames.includes("diagnose_connection_spike"), true);
    assert.equal(toolNames.includes("diagnose_lock_contention"), true);
    assert.equal(toolNames.includes("diagnose_slow_query"), true);
  });
});

localMysqlTest("local mysql MCP diagnose_db_hotspot returns SQL hotspots from digest ranking", async () => {
  await withClient(async ({ client }) => {
    for (let index = 0; index < 3; index += 1) {
      const warmup = await client.callTool({
        name: "execute_readonly_sql",
        arguments: {
          sql: "SELECT id, remark, updated_at FROM orders WHERE remark LIKE '%order%' ORDER BY updated_at DESC LIMIT 2",
        },
      });
      assert.equal(warmup.isError, false);
    }

    const result = await client.callTool({
      name: "diagnose_db_hotspot",
      arguments: {
        scope: "sql",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.data.tool, "diagnose_db_hotspot");
    assert.equal(result.structuredContent.data.status, "ok");
    assert.equal(result.structuredContent.data.scope, "sql");
    assert.equal(
      result.structuredContent.data.hotspots.some((item) => item.type === "sql"),
      true,
    );
    assert.equal(
      result.structuredContent.data.recommended_next_tools.includes("diagnose_slow_query"),
      true,
    );
  });
});

localMysqlTest("local mysql MCP find_top_slow_sql returns ranked digest candidates", async () => {
  await withClient(async ({ client }) => {
    await client.callTool({
      name: "execute_readonly_sql",
      arguments: {
        sql: "SELECT id, remark, updated_at FROM orders WHERE remark LIKE '%order%' ORDER BY updated_at DESC LIMIT 2",
      },
    });

    const result = await client.callTool({
      name: "find_top_slow_sql",
      arguments: {
        top_n: 5,
        sort_by: "total_latency",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.data.tool, "find_top_slow_sql");
    assert.equal(Array.isArray(result.structuredContent.data.top_sqls), true);
    assert.equal(result.structuredContent.data.evidence.some((item) => item.source === "statement_digest"), true);
  });
});

localMysqlTest("local mysql MCP diagnose_service_latency routes latency symptoms to slow SQL suspects", async () => {
  await withClient(async ({ client }) => {
    for (let index = 0; index < 3; index += 1) {
      const warmup = await client.callTool({
        name: "execute_readonly_sql",
        arguments: {
          sql: "SELECT id, remark, updated_at FROM orders WHERE remark LIKE '%order%' ORDER BY updated_at DESC LIMIT 2",
        },
      });
      assert.equal(warmup.isError, false);
    }

    const result = await client.callTool({
      name: "diagnose_service_latency",
      arguments: {
        symptom: "latency",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.data.tool, "diagnose_service_latency");
    assert.equal(result.structuredContent.data.status, "ok");
    assert.equal(result.structuredContent.data.suspected_category, "slow_sql");
    assert.equal(
      result.structuredContent.data.top_candidates.some((candidate) => candidate.type === "sql"),
      true,
    );
    assert.equal(
      result.structuredContent.data.recommended_next_tools.includes("diagnose_slow_query"),
      true,
    );
  });
});

localMysqlTest("local mysql MCP diagnose_slow_query returns explain-backed findings for an unindexed query shape", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({
      name: "diagnose_slow_query",
      arguments: {
        sql: "SELECT id, remark, updated_at FROM orders WHERE remark LIKE '%order%' ORDER BY updated_at DESC LIMIT 2",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.data.tool, "diagnose_slow_query");
    assert.equal(result.structuredContent.data.status, "ok");
    assert.equal(
      result.structuredContent.data.root_cause_candidates.some(
        (candidate) =>
          candidate.code === "slow_query_full_table_scan"
          || candidate.code === "slow_query_poor_index_usage",
      ),
      true,
    );
    assert.equal(
      result.structuredContent.data.evidence.some((item) => item.source === "explain"),
      true,
    );
    assert.equal(
      result.structuredContent.data.recommended_actions.length > 0,
      true,
    );
  });
});

localMysqlTest("local mysql MCP captures storage-pressure workload with real temporary disk spill", async () => {
  await prepareDatabase();
  await prepareStoragePressureFixture();
  const tmpDiskTablesCreated = await runStoragePressureWorkload();
  assert.equal(
    tmpDiskTablesCreated > 0,
    true,
    "expected the pressure workload to create at least one temporary disk table",
  );

  await withClient(async ({ client }) => {
    const storagePressure = await client.callTool({
      name: "diagnose_storage_pressure",
      arguments: {
        scope: "table",
        table: "storage_pressure_events",
        max_candidates: 5,
      },
    });

    assert.equal(storagePressure.isError, false);
    assert.equal(storagePressure.structuredContent.data.tool, "diagnose_storage_pressure");
    assert.equal(storagePressure.structuredContent.data.status, "ok");
    assert.equal(
      storagePressure.structuredContent.data.root_cause_candidates.some(
        (candidate) =>
          candidate.code === "storage_pressure_tmp_disk_spill" ||
          candidate.code === "storage_pressure_scan_heavy_sql",
      ),
      true,
    );
    assert.equal(
      storagePressure.structuredContent.data.evidence.some((item) => item.source === "statement_digest"),
      true,
    );
    assert.equal(
      storagePressure.structuredContent.data.evidence.some((item) => item.source === "table_storage"),
      true,
    );
    assert.equal(
      storagePressure.structuredContent.data.suspicious_entities.tables.some(
        (item) => item.table.endsWith(".storage_pressure_events"),
      ),
      true,
    );

    const slowQuery = await client.callTool({
      name: "diagnose_slow_query",
      arguments: {
        sql: storagePressureSql,
        max_candidates: 10,
      },
    });

    assert.equal(slowQuery.isError, false);
    assert.equal(slowQuery.structuredContent.data.tool, "diagnose_slow_query");
    assert.equal(slowQuery.structuredContent.data.status, "ok");
    assert.equal(
      slowQuery.structuredContent.data.root_cause_candidates.some(
        (candidate) =>
          candidate.code === "slow_query_tmp_disk_spill" ||
          candidate.code === "slow_query_runtime_scan_pressure",
      ),
      true,
    );
  }, { skipPrepareDatabase: true });
});

localMysqlTest("local mysql MCP diagnose_connection_spike captures idle session buildup", async () => {
  const idleConnections = [];

  try {
    await prepareDatabase();

    for (let index = 0; index < 6; index += 1) {
      idleConnections.push(await mysql.createConnection(mysqlConnectionConfig()));
    }

    await sleep(250);

    await withClient(async ({ client }) => {
      const result = await client.callTool({
        name: "diagnose_connection_spike",
        arguments: {
          user: requiredEnv("TAURUSDB_TEST_MYSQL_USER"),
        },
      });

      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.data.tool, "diagnose_connection_spike");
      assert.equal(result.structuredContent.data.status, "ok");
      assert.equal(
        result.structuredContent.data.root_cause_candidates.some(
          (candidate) => candidate.code === "connection_spike_idle_session_accumulation",
        ),
        true,
      );
      assert.equal(
        result.structuredContent.data.evidence.some((item) => item.source === "processlist"),
        true,
      );

      const serviceLatency = await client.callTool({
        name: "diagnose_service_latency",
        arguments: {
          symptom: "connection_growth",
          user: requiredEnv("TAURUSDB_TEST_MYSQL_USER"),
        },
      });
      assert.equal(serviceLatency.isError, false);
      assert.equal(serviceLatency.structuredContent.data.tool, "diagnose_service_latency");
      assert.equal(serviceLatency.structuredContent.data.status, "ok");
      assert.equal(serviceLatency.structuredContent.data.suspected_category, "connection_spike");
      assert.equal(
        serviceLatency.structuredContent.data.recommended_next_tools.includes("diagnose_connection_spike"),
        true,
      );
    }, { skipPrepareDatabase: true });
  } finally {
    await Promise.all(idleConnections.map((connection) => connection.end().catch(() => undefined)));
  }
});

localMysqlTest("local mysql MCP diagnose_lock_contention captures a live blocker chain", async () => {
  await prepareDatabase();

  const blocker = await mysql.createConnection(mysqlConnectionConfig({ mutation: true }));
  const waiterA = await mysql.createConnection(mysqlConnectionConfig({ mutation: true }));
  const waiterB = await mysql.createConnection(mysqlConnectionConfig({ mutation: true }));
  let waiterAQuery;
  let waiterBQuery;

  try {
    await blocker.query("SET SESSION innodb_lock_wait_timeout = 30");
    await waiterA.query("SET SESSION innodb_lock_wait_timeout = 30");
    await waiterB.query("SET SESSION innodb_lock_wait_timeout = 30");

    await blocker.beginTransaction();
    await blocker.query("UPDATE orders SET remark = 'lock-holder' WHERE order_no = 'ORD-1001'");

    await waiterA.beginTransaction();
    waiterAQuery = waiterA
      .query("UPDATE orders SET remark = 'lock-waiter-a' WHERE order_no = 'ORD-1001'")
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );

    await waiterB.beginTransaction();
    waiterBQuery = waiterB
      .query("UPDATE orders SET remark = 'lock-waiter-b' WHERE order_no = 'ORD-1001'")
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );

    await sleep(500);

    await withClient(async ({ client }) => {
      const result = await client.callTool({
        name: "diagnose_lock_contention",
        arguments: {
          table: "orders",
        },
      });

      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.data.tool, "diagnose_lock_contention");
      assert.equal(result.structuredContent.data.status, "ok");
      assert.equal(
        result.structuredContent.data.root_cause_candidates.some(
          (candidate) => candidate.code === "lock_contention_single_blocker_hotspot",
        ),
        true,
      );
      assert.equal(
        result.structuredContent.data.root_cause_candidates.some(
          (candidate) => candidate.code === "lock_contention_hot_table",
        ),
        true,
      );
      assert.equal(
        result.structuredContent.data.evidence.some((item) => item.source === "lock_waits"),
        true,
      );

      const serviceLatency = await client.callTool({
        name: "diagnose_service_latency",
        arguments: {
          symptom: "timeout",
        },
      });
      assert.equal(serviceLatency.isError, false);
      assert.equal(serviceLatency.structuredContent.data.tool, "diagnose_service_latency");
      assert.equal(serviceLatency.structuredContent.data.status, "ok");
      assert.equal(serviceLatency.structuredContent.data.suspected_category, "lock_contention");
      assert.equal(
        serviceLatency.structuredContent.data.recommended_next_tools.includes("diagnose_lock_contention"),
        true,
      );
    }, { skipPrepareDatabase: true });

    await blocker.rollback();

    const waiterAResult = await waiterAQuery;
    assert.equal(waiterAResult.ok, true, waiterAResult.error?.message);
    await waiterA.rollback();

    const waiterBResult = await waiterBQuery;
    assert.equal(waiterBResult.ok, true, waiterBResult.error?.message);
    await waiterB.rollback();
  } finally {
    await blocker.rollback().catch(() => undefined);
    await waiterAQuery;
    await waiterA.rollback().catch(() => undefined);
    await waiterBQuery;
    await waiterB.rollback().catch(() => undefined);
    await Promise.all([
      blocker.end().catch(() => undefined),
      waiterA.end().catch(() => undefined),
      waiterB.end().catch(() => undefined),
    ]);
  }
});
