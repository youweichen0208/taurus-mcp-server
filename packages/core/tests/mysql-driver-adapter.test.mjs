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
