import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterSchemaIntrospector,
  SchemaIntrospectionError,
} from "../dist/schema/introspector.js";

function makeContext(engine = "mysql") {
  return {
    task_id: "task_test_001",
    datasource: "local_ds",
    engine,
    database: "demo",
    limits: {
      readonly: true,
      timeoutMs: 3000,
      maxRows: 100,
      maxColumns: 20,
    },
  };
}

function makeAdapter(name) {
  const calls = [];
  const adapter = {
    async listDatabases(_ctx) {
      calls.push({ fn: "listDatabases" });
      return [{ name: `${name}_db` }];
    },
    async listTables(_ctx, database) {
      calls.push({ fn: "listTables", database });
      return [{ database, name: `${name}_table` }];
    },
    async describeTable(_ctx, database, table) {
      calls.push({ fn: "describeTable", database, table });
      return {
        database,
        table,
        columns: [],
        indexes: [],
      };
    },
  };
  return { adapter, calls };
}

test("schema introspector routes calls to adapter by engine", async () => {
  const mysql = makeAdapter("mysql");
  const pg = makeAdapter("pg");

  const introspector = new AdapterSchemaIntrospector({
    adapters: {
      mysql: mysql.adapter,
      postgresql: pg.adapter,
    },
  });

  const mysqlCtx = makeContext("mysql");
  const pgCtx = makeContext("postgresql");

  const dbs = await introspector.listDatabases(mysqlCtx);
  assert.equal(dbs[0].name, "mysql_db");

  const tables = await introspector.listTables(pgCtx, "analytics");
  assert.equal(tables[0].name, "pg_table");

  await introspector.describeTable(mysqlCtx, "demo", "orders");

  assert.equal(mysql.calls.length, 2);
  assert.deepEqual(mysql.calls[0], { fn: "listDatabases" });
  assert.deepEqual(mysql.calls[1], { fn: "describeTable", database: "demo", table: "orders" });

  assert.equal(pg.calls.length, 1);
  assert.deepEqual(pg.calls[0], { fn: "listTables", database: "analytics" });
});

test("schema introspector throws when adapter is missing", async () => {
  const introspector = new AdapterSchemaIntrospector({
    adapters: {},
  });

  await assert.rejects(async () => introspector.listDatabases(makeContext("mysql")), (error) => {
    assert.ok(error instanceof SchemaIntrospectionError);
    assert.equal(error.code, "SCHEMA_ADAPTER_NOT_FOUND");
    return true;
  });
});

test("schema introspector validates database and table inputs", async () => {
  const mysql = makeAdapter("mysql");
  const introspector = new AdapterSchemaIntrospector({
    adapters: { mysql: mysql.adapter },
  });

  await assert.rejects(async () => introspector.listTables(makeContext("mysql"), "   "), (error) => {
    assert.ok(error instanceof SchemaIntrospectionError);
    assert.equal(error.code, "INVALID_INTROSPECTION_INPUT");
    return true;
  });

  await assert.rejects(
    async () => introspector.describeTable(makeContext("mysql"), "demo", "  "),
    /Invalid table: value cannot be empty/,
  );
});
