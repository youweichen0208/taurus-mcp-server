import assert from "node:assert/strict";
import test from "node:test";

import { createGuardrail } from "../dist/safety/guardrail.js";

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

test("guardrail blocks when SQL parse fails", async () => {
  const guardrail = createGuardrail();
  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT FROM",
    context: makeContext(),
  });

  assert.equal(decision.action, "block");
  assert.equal(decision.riskLevel, "blocked");
  assert.ok(decision.reasonCodes.includes("G001"));
});

test("guardrail short-circuits on tool scope block", async () => {
  const guardrail = createGuardrail();

  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "UPDATE users SET status = 'x' WHERE id = 1",
    context: makeContext(),
  });

  assert.equal(decision.action, "block");
  assert.ok(decision.reasonCodes.includes("T001"));
});

test("guardrail blocks on static rules", async () => {
  const guardrail = createGuardrail();

  const decision = await guardrail.inspect({
    toolName: "execute_sql",
    sql: "UPDATE users SET status = 'x'",
    context: makeContext({
      limits: {
        readonly: false,
        timeoutMs: 5000,
        maxRows: 200,
        maxColumns: 50,
      },
    }),
  });

  assert.equal(decision.action, "block");
  assert.ok(decision.reasonCodes.includes("R005"));
});

test("guardrail confirms update with WHERE and keeps requiresExplain off", async () => {
  const guardrail = createGuardrail();
  const decision = await guardrail.inspect({
    toolName: "execute_sql",
    sql: "UPDATE users SET status = 'x' WHERE id = 1",
    context: makeContext({
      limits: {
        readonly: false,
        timeoutMs: 5000,
        maxRows: 200,
        maxColumns: 50,
      },
    }),
  });

  assert.equal(decision.action, "confirm");
  assert.equal(decision.requiresExplain, false);
  assert.equal(decision.requiresConfirmation, true);
  assert.ok(decision.reasonCodes.includes("R006"));
});

test("guardrail blocks SQL that references a different database", async () => {
  const guardrail = createGuardrail();
  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT id FROM tenant_b.users LIMIT 1",
    context: makeContext({ database: "tenant_a" }),
  });
  assert.equal(decision.action, "block");
  assert.ok(decision.reasonCodes.includes("D002"));
});

test("guardrail conservatively masks aliases sourced from sensitive columns", async () => {
  const guardrail = createGuardrail();
  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT email AS contact FROM users LIMIT 1",
    context: makeContext(),
  });
  assert.equal(decision.action, "allow");
  assert.equal(decision.runtimeLimits.maskAllColumns, true);
});

test("guardrail accepts a quoted hyphenated database only when it matches the bound target", async () => {
  const guardrail = createGuardrail();
  const allowed = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT id FROM `db-1`.`orders` LIMIT 1",
    context: makeContext({ database: "db-1" }),
  });
  assert.equal(allowed.action, "allow");

  const blocked = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT id FROM `db-2`.`orders` LIMIT 1",
    context: makeContext({ database: "db-1" }),
  });
  assert.equal(blocked.action, "block");
  assert.ok(blocked.reasonCodes.includes("D002"));
});
