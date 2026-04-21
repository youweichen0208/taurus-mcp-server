import assert from "node:assert/strict";
import test from "node:test";

import { createSqlExecutor } from "../dist/executor/sql-executor.js";

function makeContext(overrides = {}) {
  return {
    task_id: "task_001",
    datasource: "local_mysql",
    engine: "mysql",
    database: "demo",
    limits: {
      readonly: true,
      timeoutMs: 5000,
      maxRows: 200,
      maxColumns: 50,
      maxFieldChars: 2048,
    },
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockConnectionPool(queryHandler, cancelHandler) {
  const state = {
    acquires: [],
    releases: [],
    executions: [],
    cancels: [],
  };

  let sessionSeq = 0;
  const pool = {
    async acquire(datasource, mode) {
      sessionSeq += 1;
      const sessionId = `sess_${sessionSeq}`;
      state.acquires.push({ datasource, mode, sessionId });

      return {
        id: sessionId,
        datasource,
        mode,
        async execute(sql, options) {
          state.executions.push({ sessionId, mode, sql, options });
          return queryHandler({ sessionId, mode, sql, options });
        },
        async cancel() {
          state.cancels.push({ sessionId, mode });
          if (cancelHandler) {
            await cancelHandler({ sessionId, mode });
          }
        },
        async close() {},
      };
    },
    async release(session) {
      state.releases.push(session.id);
    },
    async healthCheck() {
      return { datasource: "mock", checkedAt: new Date().toISOString(), modes: [] };
    },
    async close() {},
  };

  return { pool, state };
}

test("sql executor executeReadonly uses ro session and truncates rows", async () => {
  const { pool, state } = makeMockConnectionPool(({ sql }) => {
    assert.equal(sql, "SELECT id, name FROM users");
    return {
      rows: [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ],
      rowCount: 3,
      fields: [{ name: "id", type: "bigint" }, { name: "name", type: "varchar" }],
    };
  });

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: (() => {
      let seq = 0;
      return () => `qry_${++seq}`;
    })(),
  });

  const result = await executor.executeReadonly("SELECT id, name FROM users", makeContext(), {
    maxRows: 2,
    timeoutMs: 1234,
  });

  assert.equal(state.acquires.length, 1);
  assert.equal(state.acquires[0].mode, "ro");
  assert.equal(state.executions[0].options.timeoutMs, 1234);
  assert.equal(result.queryId, "qry_1");
  assert.equal(result.columns.length, 2);
  assert.deepEqual(result.rows, [
    [1, "a"],
    [2, "b"],
  ]);
  assert.equal(result.rowCount, 3);
  assert.equal(result.truncated, true);

  const status = await executor.getQueryStatus("qry_1");
  assert.equal(status.status, "completed");
  assert.equal(status.mode, "ro");
});

test("sql executor executeReadonly applies result redaction policy", async () => {
  const { pool } = makeMockConnectionPool(({ sql }) => {
    assert.equal(sql, "SELECT id, name, password, notes FROM users");
    return {
      rows: [
        { id: 1, name: "AliceLong", password: "secret_1", notes: "note_1" },
        { id: 2, name: "BobLong", password: "secret_2", notes: "note_2" },
      ],
      rowCount: 2,
      fields: [
        { name: "id", type: "bigint" },
        { name: "name", type: "varchar" },
        { name: "password", type: "varchar" },
        { name: "notes", type: "varchar" },
      ],
    };
  });

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: () => "qry_redaction",
  });

  const result = await executor.executeReadonly(
    "SELECT id, name, password, notes FROM users",
    makeContext({
      limits: {
        readonly: true,
        timeoutMs: 5000,
        maxRows: 200,
        maxColumns: 3,
        maxFieldChars: 5,
      },
    }),
  );

  assert.equal(result.queryId, "qry_redaction");
  assert.equal(result.truncated, true);
  assert.equal(result.columnTruncated, true);
  assert.equal(result.fieldTruncated, true);
  assert.deepEqual(result.columns.map((column) => column.name), ["id", "name", "password"]);
  assert.deepEqual(result.redactedColumns, ["password"]);
  assert.deepEqual(result.droppedColumns, []);
  assert.deepEqual(result.truncatedColumns, ["name"]);
  assert.deepEqual(result.rows, [
    [1, "Alice...[TRUNCATED]", "***"],
    [2, "BobLo...[TRUNCATED]", "***"],
  ]);
});

test("sql executor executeMutation wraps sql in begin/commit", async () => {
  const executedSql = [];
  const { pool, state } = makeMockConnectionPool(({ sql, mode }) => {
    assert.equal(mode, "rw");
    executedSql.push(sql);
    if (sql === "BEGIN" || sql === "COMMIT") {
      return { rows: [] };
    }
    return { affectedRows: 2 };
  });

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: () => "qry_mutation",
  });

  const result = await executor.executeMutation(
    "UPDATE users SET status='done' WHERE id=1",
    makeContext({
      limits: {
        readonly: false,
        timeoutMs: 5000,
        maxRows: 200,
        maxColumns: 50,
      },
    }),
    { timeoutMs: 2222 },
  );

  assert.equal(state.acquires[0].mode, "rw");
  assert.deepEqual(executedSql, [
    "BEGIN",
    "UPDATE users SET status='done' WHERE id=1",
    "COMMIT",
  ]);
  assert.equal(result.queryId, "qry_mutation");
  assert.equal(result.affectedRows, 2);

  const status = await executor.getQueryStatus("qry_mutation");
  assert.equal(status.status, "completed");
  assert.equal(status.mode, "rw");
});

test("sql executor executeMutation rolls back on error", async () => {
  const executedSql = [];
  const { pool } = makeMockConnectionPool(({ sql }) => {
    executedSql.push(sql);
    if (sql === "BEGIN") {
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE")) {
      throw new Error("write failed");
    }
    return { rows: [] };
  });

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: () => "qry_fail",
  });

  await assert.rejects(
    () =>
      executor.executeMutation(
        "UPDATE users SET status='x' WHERE id=1",
        makeContext({
          limits: {
            readonly: false,
            timeoutMs: 5000,
            maxRows: 200,
            maxColumns: 50,
          },
        }),
      ),
    /write failed/,
  );

  assert.deepEqual(executedSql, [
    "BEGIN",
    "UPDATE users SET status='x' WHERE id=1",
    "ROLLBACK",
  ]);

  const status = await executor.getQueryStatus("qry_fail");
  assert.equal(status.status, "failed");
});

test("sql executor explain returns plan, summary and recommendations", async () => {
  const { pool } = makeMockConnectionPool(() => {
    return {
      rows: [{ type: "ALL", key: null, rows: 50, Extra: "Using filesort" }],
    };
  });

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: () => "qry_explain",
  });

  const result = await executor.explain("SELECT * FROM users", makeContext());
  assert.equal(result.queryId, "qry_explain");
  assert.equal(result.plan.length, 1);
  assert.equal(result.riskSummary.fullTableScanLikely, true);
  assert.ok(result.recommendations.length > 0);
});

test("sql executor can cancel running query", async () => {
  const deferred = createDeferred();
  const { pool, state } = makeMockConnectionPool(
    ({ sql }) => {
      if (sql === "SELECT sleep_query") {
        return deferred.promise;
      }
      return { rows: [] };
    },
    async () => {
      deferred.reject(new Error("cancelled by user"));
    },
  );

  const executor = createSqlExecutor({
    connectionPool: pool,
    queryIdGenerator: () => "qry_running",
  });

  const runPromise = executor
    .executeReadonly("SELECT sleep_query", makeContext(), { timeoutMs: 9999 })
    .then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

  await new Promise((resolve) => setImmediate(resolve));
  const running = await executor.getQueryStatus("qry_running");
  assert.equal(running.status, "running");

  const cancel = await executor.cancelQuery("qry_running");
  assert.equal(cancel.status, "cancelled");
  assert.equal(state.cancels.length, 1);

  const runResult = await runPromise;
  assert.equal(runResult.ok, false);
  assert.match(runResult.error.message, /cancelled/);

  const status = await executor.getQueryStatus("qry_running");
  assert.equal(status.status, "cancelled");
});

test("sql executor getQueryStatus and cancelQuery handle missing ids", async () => {
  const { pool } = makeMockConnectionPool(() => ({ rows: [] }));
  const executor = createSqlExecutor({
    connectionPool: pool,
  });

  const status = await executor.getQueryStatus("qry_unknown");
  assert.equal(status.status, "not_found");

  const cancel = await executor.cancelQuery("qry_unknown");
  assert.equal(cancel.status, "not_found");
});
