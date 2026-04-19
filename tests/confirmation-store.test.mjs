import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryConfirmationStore } from "../dist/safety/confirmation-store.js";
import { normalizeSql, sqlHash } from "../dist/utils/hash.js";

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
    },
    ...overrides,
  };
}

function makeIssueInput(sql, ctx = makeContext()) {
  const normalizedSql = normalizeSql(sql);
  return {
    sqlHash: sqlHash(normalizedSql),
    normalizedSql,
    context: ctx,
    riskLevel: "high",
    ttlSeconds: 300,
  };
}

test("confirmation store issues token with expected shape", async () => {
  let now = 1_700_000_000_000;
  const store = new InMemoryConfirmationStore({
    now: () => now,
    cleanupIntervalMs: 0,
    randomBytesFn: () => Buffer.alloc(32, 1),
  });

  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));

  assert.match(issued.token, /^ctok_[A-Za-z0-9_-]+$/);
  assert.equal(issued.issuedAt, now);
  assert.equal(issued.expiresAt, now + 300_000);
});

test("confirmation store validates token and enforces one-time usage", async () => {
  const sql = "UPDATE users SET status='x' WHERE id=1";
  const ctx = makeContext();
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
  });

  const issued = await store.issue(makeIssueInput(sql, ctx));
  const first = await store.validate(issued.token, sql, ctx);
  assert.equal(first.valid, true);
  assert.equal(first.action, "allow");

  const second = await store.validate(issued.token, sql, ctx);
  assert.equal(second.valid, false);
  assert.equal(second.action, "block");
  assert.deepEqual(second.reasonCodes, ["CF005"]);
});

test("confirmation store rejects unknown token", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
  });

  const result = await store.validate("ctok_missing", "SELECT 1", makeContext());
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF001"]);
});

test("confirmation store rejects expired token", async () => {
  let now = 1000;
  const store = new InMemoryConfirmationStore({
    now: () => now,
    cleanupIntervalMs: 0,
    randomBytesFn: () => Buffer.alloc(32, 2),
  });

  const issued = await store.issue({
    ...makeIssueInput("DELETE FROM users WHERE id=1"),
    ttlSeconds: 1,
  });

  now += 1500;
  const result = await store.validate(
    issued.token,
    "DELETE FROM users WHERE id=1",
    makeContext(),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF002"]);
});

test("confirmation store rejects sql hash mismatch", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
  });

  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));
  const result = await store.validate(
    issued.token,
    "UPDATE users SET status='y' WHERE id=2",
    makeContext(),
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF003"]);
});

test("confirmation store rejects datasource/database mismatch", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
  });
  const issued = await store.issue(
    makeIssueInput("DELETE FROM users WHERE id=1", makeContext({ datasource: "prod", database: "app" })),
  );

  const mismatchDatasource = await store.validate(
    issued.token,
    "DELETE FROM users WHERE id=1",
    makeContext({ datasource: "staging", database: "app" }),
  );
  assert.equal(mismatchDatasource.valid, false);
  assert.deepEqual(mismatchDatasource.reasonCodes, ["CF004"]);

  const mismatchDatabase = await store.validate(
    issued.token,
    "DELETE FROM users WHERE id=1",
    makeContext({ datasource: "prod", database: "app2" }),
  );
  assert.equal(mismatchDatabase.valid, false);
  assert.deepEqual(mismatchDatabase.reasonCodes, ["CF004"]);
});

test("confirmation store revoke invalidates token", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
  });
  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));

  await store.revoke(issued.token);
  const result = await store.validate(
    issued.token,
    "UPDATE users SET status='x' WHERE id=1",
    makeContext(),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF001"]);
});
