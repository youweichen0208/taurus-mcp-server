import assert from "node:assert/strict";
import test from "node:test";

import mysql from "mysql2/promise";
import { createMySqlDriverAdapter } from "../dist/executor/adapters/mysql.js";

test("mysql driver adapter preserves temporal values as strings", async () => {
  const originalCreatePool = mysql.createPool;
  let capturedOptions;

  mysql.createPool = (options) => {
    capturedOptions = options;
    return {
      async getConnection() {
        throw new Error("not used in this test");
      },
      async end() {},
    };
  };

  try {
    const adapter = createMySqlDriverAdapter();
    await adapter.createPool({
      host: "127.0.0.1",
      port: 3306,
      database: "demo",
      username: "reader",
      password: "secret",
      poolSize: 4,
    });
  } finally {
    mysql.createPool = originalCreatePool;
  }

  assert.equal(capturedOptions.dateStrings, true);
});

async function sessionReturning(queryResult) {
  const originalCreatePool = mysql.createPool;
  mysql.createPool = () => ({
    async getConnection() {
      return {
        async query() { return queryResult; },
        release() {},
        destroy() {},
      };
    },
    async end() {},
  });
  try {
    const pool = await createMySqlDriverAdapter().createPool({
      host: "127.0.0.1", port: 3306, username: "reader", password: "secret",
    });
    return await pool.acquire();
  } finally {
    mysql.createPool = originalCreatePool;
  }
}

const STATUS_PACKET = { fieldCount: 0, affectedRows: 0, insertId: 0, info: "", serverStatus: 34, warningStatus: 0 };

test("mysql driver adapter unwraps a CALL result set and its trailing status packet", async () => {
  const session = await sessionReturning([
    [[{ SCHEMA: "__recyclebin__", TABLE: "__innodb_1063", ORIGIN_TABLE: "orders" }], STATUS_PACKET],
    [[{ name: "SCHEMA", columnType: 253 }, { name: "TABLE", columnType: 253 }, { name: "ORIGIN_TABLE", columnType: 253 }], undefined],
  ]);
  const result = await session.execute("call dbms_recyclebin.show_tables()");
  assert.deepEqual(result.fields.map((field) => field.name), ["SCHEMA", "TABLE", "ORIGIN_TABLE"]);
  assert.deepEqual(result.rows, [{ SCHEMA: "__recyclebin__", TABLE: "__innodb_1063", ORIGIN_TABLE: "orders" }]);
  assert.equal(result.rowCount, 1);
});

test("mysql driver adapter handles an empty CALL result set", async () => {
  const session = await sessionReturning([
    [[], STATUS_PACKET],
    [[{ name: "TABLE", columnType: 253 }], undefined],
  ]);
  const result = await session.execute("call dbms_recyclebin.show_tables()");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.fields.map((field) => field.name), ["TABLE"]);
});

test("mysql driver adapter rejects unrecognized multi-result procedure output", async () => {
  const session = await sessionReturning([
    [[{ a: 1 }], [{ b: 2 }], STATUS_PACKET],
    [[{ name: "a" }], [{ name: "b" }], undefined],
  ]);
  await assert.rejects(session.execute("call x()"), /Unrecognized stored procedure result structure/);
});

test("mysql driver adapter leaves ordinary SELECT rows untouched", async () => {
  const session = await sessionReturning([
    [{ id: 1, affectedRows: 5 }],
    [{ name: "id", columnType: 3 }, { name: "affectedRows", columnType: 3 }],
  ]);
  const result = await session.execute("SELECT id, affectedRows FROM t");
  assert.deepEqual(result.rows, [{ id: 1, affectedRows: 5 }]);
  assert.deepEqual(result.fields.map((field) => field.name), ["id", "affectedRows"]);
});
