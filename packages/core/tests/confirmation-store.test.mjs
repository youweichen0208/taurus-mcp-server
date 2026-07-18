import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryConfirmationStore,
  signApprovalRequest,
} from "../dist/safety/confirmation-store.js";
import { normalizeSql, sqlHash } from "../dist/utils/hash.js";

const APPROVAL_SECRET = "test-approval-secret-that-is-at-least-32-bytes";

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

test("confirmation store issues an unsigned external approval request", async () => {
  let now = 1_700_000_000_000;
  const store = new InMemoryConfirmationStore({
    now: () => now,
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
    randomBytesFn: () => Buffer.alloc(32, 1),
  });

  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));

  assert.match(issued.request, /^creq_[A-Za-z0-9_-]+$/);
  assert.equal(typeof issued.requestId, "string");
  assert.equal(issued.issuedAt, now);
  assert.equal(issued.expiresAt, now + 300_000);
});

test("confirmation store validates token and enforces one-time usage", async () => {
  const sql = "UPDATE users SET status='x' WHERE id=1";
  const ctx = makeContext();
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });

  const issued = await store.issue(makeIssueInput(sql, ctx));
  const token = signApprovalRequest(issued.request, "operator@example.com", APPROVAL_SECRET);
  const first = await store.validate(token, sql, ctx);
  assert.equal(first.valid, true);
  assert.equal(first.actor, "operator@example.com");
  assert.equal(first.action, "allow");

  const second = await store.validate(token, sql, ctx);
  assert.equal(second.valid, false);
  assert.equal(second.action, "block");
  assert.deepEqual(second.reasonCodes, ["CF005"]);
});

test("confirmation store rejects unknown token", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
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
    approvalSecret: APPROVAL_SECRET,
    randomBytesFn: () => Buffer.alloc(32, 2),
  });

  const issued = await store.issue({
    ...makeIssueInput("DELETE FROM users WHERE id=1"),
    ttlSeconds: 1,
  });
  const token = signApprovalRequest(issued.request, "operator", APPROVAL_SECRET);

  now += 1500;
  const result = await store.validate(
    token,
    "DELETE FROM users WHERE id=1",
    makeContext(),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF002"]);
});

test("confirmation store rejects sql hash mismatch", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });

  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));
  const token = signApprovalRequest(issued.request, "operator", APPROVAL_SECRET);
  const result = await store.validate(
    token,
    "UPDATE users SET status='y' WHERE id=2",
    makeContext(),
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF003"]);
});

test("confirmation store rejects datasource/database mismatch", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });
  const issued = await store.issue(
    makeIssueInput("DELETE FROM users WHERE id=1", makeContext({ datasource: "prod", database: "app" })),
  );
  const token = signApprovalRequest(issued.request, "operator", APPROVAL_SECRET);

  const mismatchDatasource = await store.validate(
    token,
    "DELETE FROM users WHERE id=1",
    makeContext({ datasource: "staging", database: "app" }),
  );
  assert.equal(mismatchDatasource.valid, false);
  assert.deepEqual(mismatchDatasource.reasonCodes, ["CF004"]);

  const mismatchDatabase = await store.validate(
    token,
    "DELETE FROM users WHERE id=1",
    makeContext({ datasource: "prod", database: "app2" }),
  );
  assert.equal(mismatchDatabase.valid, false);
  assert.deepEqual(mismatchDatabase.reasonCodes, ["CF004"]);
});

test("confirmation store rejects a token after the cloud target changes", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });
  const originalContext = makeContext({
    host: "10.0.0.8",
    port: 3306,
    projectId: "project-1",
    instanceId: "instance-1",
    nodeId: "node-1",
  });
  const issued = await store.issue(
    makeIssueInput("DELETE FROM users WHERE id=1", originalContext),
  );
  const token = signApprovalRequest(issued.request, "operator", APPROVAL_SECRET);
  const result = await store.validate(
    token,
    "DELETE FROM users WHERE id=1",
    { ...originalContext, instanceId: "instance-2", host: "10.0.0.9" },
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF004"]);
});

test("confirmation store revoke invalidates token", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });
  const issued = await store.issue(makeIssueInput("UPDATE users SET status='x' WHERE id=1"));

  const token = signApprovalRequest(issued.request, "operator", APPROVAL_SECRET);
  await store.revoke(issued.requestId);
  const result = await store.validate(
    token,
    "UPDATE users SET status='x' WHERE id=1",
    makeContext(),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF001"]);
});

test("confirmation store rejects tokens signed by a different approver secret", async () => {
  const store = new InMemoryConfirmationStore({
    cleanupIntervalMs: 0,
    approvalSecret: APPROVAL_SECRET,
  });
  const issued = await store.issue(makeIssueInput("DELETE FROM users WHERE id=1"));
  const token = signApprovalRequest(
    issued.request,
    "attacker",
    "different-secret-that-is-also-at-least-32-bytes",
  );
  const result = await store.validate(token, "DELETE FROM users WHERE id=1", makeContext());
  assert.equal(result.valid, false);
  assert.deepEqual(result.reasonCodes, ["CF007"]);
});
