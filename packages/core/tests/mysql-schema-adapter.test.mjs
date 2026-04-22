import assert from "node:assert/strict";
import test from "node:test";

import { MySqlSchemaAdapter } from "../dist/schema/adapters/mysql.js";

function makeContext({
  task_id = "task_001",
  datasource = "local_mysql",
  timeoutMs = 5000,
} = {}) {
  return {
    task_id,
    datasource,
    engine: "mysql",
    database: "demo",
    limits: {
      readonly: true,
      timeoutMs,
      maxRows: 200,
      maxColumns: 50,
    },
  };
}

function makeMockConnectionPool(queryHandler) {
  const state = {
    acquires: [],
    releases: [],
    executes: [],
  };

  const pool = {
    async acquire(datasource, mode) {
      state.acquires.push({ datasource, mode });
      const sessionId = `session_${state.acquires.length}`;
      return {
        id: sessionId,
        datasource,
        mode,
        async execute(sql, options) {
          state.executes.push({ sql, options, datasource, mode });
          return queryHandler(sql, options);
        },
        async cancel() {},
        async close() {},
      };
    },
    async release(session) {
      state.releases.push(session.id);
    },
    async healthCheck() {
      return {
        datasource: "mock",
        checkedAt: new Date().toISOString(),
        modes: [],
      };
    },
    async close() {},
  };

  return { pool, state };
}

function createAdapterWithDefaultMock() {
  const { pool, state } = makeMockConnectionPool((sql) => {
    if (sql.includes("FROM information_schema.SCHEMATA")) {
      return {
        rows: [{ schema_name: "demo" }, { schema_name: "analytics" }],
      };
    }

    if (sql.includes("FROM information_schema.TABLES") && sql.includes("ORDER BY TABLE_NAME")) {
      return {
        rows: [
          {
            table_name: "orders",
            table_type: "BASE TABLE",
            table_comment: "orders table",
            table_rows: 123,
          },
          {
            table_name: "orders_view",
            table_type: "VIEW",
            table_comment: "orders view",
            table_rows: null,
          },
        ],
      };
    }

    if (sql.includes("FROM information_schema.COLUMNS")) {
      return {
        rows: [
          {
            column_name: "id",
            data_type: "bigint",
            is_nullable: "NO",
            column_default: null,
            column_key: "PRI",
            column_comment: "primary id",
            character_maximum_length: null,
          },
          {
            column_name: "created_at",
            data_type: "timestamp",
            is_nullable: "YES",
            column_default: null,
            column_key: "",
            column_comment: "",
            character_maximum_length: null,
          },
          {
            column_name: "phone_number",
            data_type: "varchar",
            is_nullable: "YES",
            column_default: null,
            column_key: "",
            column_comment: "masked",
            character_maximum_length: 64,
          },
          {
            column_name: "note",
            data_type: "text",
            is_nullable: "YES",
            column_default: null,
            column_key: "",
            column_comment: "",
            character_maximum_length: 2048,
          },
        ],
      };
    }

    if (sql.includes("FROM information_schema.STATISTICS")) {
      return {
        rows: [
          {
            index_name: "PRIMARY",
            column_name: "id",
            non_unique: 0,
            seq_in_index: 1,
            index_type: "BTREE",
          },
          {
            index_name: "idx_created_at",
            column_name: "created_at",
            non_unique: 1,
            seq_in_index: 1,
            index_type: "BTREE",
          },
        ],
      };
    }

    if (sql.includes("FROM information_schema.TABLES") && sql.includes("LIMIT 1")) {
      return {
        rows: [{ table_rows: 123, table_comment: "orders table" }],
      };
    }

    if (sql.includes("FROM `demo`.`orders`")) {
      return {
        rows: [
          {
            id: 1,
            created_at: "2026-01-01 00:00:00",
            phone_number: "13800000000",
            note: "first row",
          },
          {
            id: 2,
            created_at: "2026-01-02 00:00:00",
            phone_number: "13900000000",
            note: "second row",
          },
        ],
      };
    }

    return { rows: [] };
  });

  return {
    adapter: new MySqlSchemaAdapter({ connectionPool: pool }),
    state,
  };
}

test("mysql adapter lists databases", async () => {
  const { adapter, state } = createAdapterWithDefaultMock();
  const dbs = await adapter.listDatabases(makeContext());

  assert.deepEqual(dbs, [{ name: "demo" }, { name: "analytics" }]);
  assert.equal(state.acquires.length, 1);
  assert.equal(state.acquires[0].mode, "ro");
  assert.equal(state.releases.length, 1);
  assert.equal(state.executes[0].options.timeoutMs, 5000);
});

test("mysql adapter lists tables with mapped type/comment/row count", async () => {
  const { adapter } = createAdapterWithDefaultMock();
  const tables = await adapter.listTables(makeContext(), "demo");

  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0], {
    database: "demo",
    name: "orders",
    type: "table",
    comment: "orders table",
    rowCountEstimate: 123,
  });
  assert.deepEqual(tables[1], {
    database: "demo",
    name: "orders_view",
    type: "view",
    comment: "orders view",
    rowCountEstimate: undefined,
  });
});

test("mysql adapter describes table and builds engine hints", async () => {
  const { adapter } = createAdapterWithDefaultMock();
  const schema = await adapter.describeTable(makeContext(), "demo", "orders");

  assert.equal(schema.database, "demo");
  assert.equal(schema.table, "orders");
  assert.equal(schema.columns.length, 4);
  assert.equal(schema.indexes.length, 2);
  assert.deepEqual(schema.primaryKey, ["id"]);
  assert.equal(schema.rowCountEstimate, 123);
  assert.equal(schema.comment, "orders table");

  assert.ok(schema.engineHints.likelyTimeColumns.includes("created_at"));
  assert.ok(schema.engineHints.likelyFilterColumns.includes("id"));
  assert.ok(schema.engineHints.likelyFilterColumns.includes("created_at"));
  assert.ok(schema.engineHints.sensitiveColumns.includes("phone_number"));
});

test("mysql adapter safely escapes literals in metadata queries", async () => {
  const { pool, state } = makeMockConnectionPool(() => ({ rows: [] }));
  const adapter = new MySqlSchemaAdapter({ connectionPool: pool });

  await adapter.listTables(makeContext(), "de'mo");
  const sql = state.executes[0].sql;
  assert.match(sql, /WHERE TABLE_SCHEMA = 'de''mo'/);
});
