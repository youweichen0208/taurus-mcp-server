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

function makeTableSchema({ database = "demo", table = "users", columns = ["id"], sensitive = [] } = {}) {
  return {
    database,
    table,
    columns: columns.map((name) => ({
      name,
      dataType: "varchar",
      nullable: true,
    })),
    indexes: [],
    primaryKey: ["id"],
    engineHints: {
      likelyTimeColumns: [],
      likelyFilterColumns: ["id"],
      sensitiveColumns: sensitive,
    },
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
  let schemaCalls = 0;
  let explainCalls = 0;

  const guardrail = createGuardrail({
    schemaIntrospector: {
      async describeTable() {
        schemaCalls += 1;
        return makeTableSchema();
      },
    },
    executor: {
      async explainForGuardrail() {
        explainCalls += 1;
        return {
          fullTableScanLikely: false,
          indexHitLikely: true,
          estimatedRows: 10,
          usesTempStructure: false,
          usesFilesort: false,
          riskHints: [],
        };
      },
    },
  });

  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "UPDATE users SET status = 'x' WHERE id = 1",
    context: makeContext(),
  });

  assert.equal(decision.action, "block");
  assert.ok(decision.reasonCodes.includes("T001"));
  assert.equal(schemaCalls, 0);
  assert.equal(explainCalls, 0);
});

test("guardrail blocks on static rules before schema and explain", async () => {
  let schemaCalls = 0;
  let explainCalls = 0;

  const guardrail = createGuardrail({
    schemaIntrospector: {
      async describeTable() {
        schemaCalls += 1;
        return makeTableSchema();
      },
    },
    executor: {
      async explainForGuardrail() {
        explainCalls += 1;
        return {
          fullTableScanLikely: false,
          indexHitLikely: true,
          estimatedRows: 10,
          usesTempStructure: false,
          usesFilesort: false,
          riskHints: [],
        };
      },
    },
  });

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
  assert.equal(schemaCalls, 0);
  assert.equal(explainCalls, 0);
});

test("guardrail blocks on schema-aware missing table", async () => {
  const guardrail = createGuardrail({
    schemaIntrospector: {
      async describeTable(_ctx, database, table) {
        throw new Error(`Table not found: ${database}.${table}`);
      },
    },
  });

  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT id FROM orders LIMIT 10",
    context: makeContext(),
  });

  assert.equal(decision.action, "block");
  assert.ok(decision.reasonCodes.includes("R009"));
});

test("guardrail runs explain and merges cost decision", async () => {
  let explainCalls = 0;
  const guardrail = createGuardrail({
    schemaIntrospector: {
      async describeTable(_ctx, _database, table) {
        if (table.toLowerCase() === "users") {
          return makeTableSchema({ table: "users", columns: ["id", "name"] });
        }
        throw new Error(`Table not found: ${table}`);
      },
    },
    executor: {
      async explainForGuardrail() {
        explainCalls += 1;
        return {
          fullTableScanLikely: true,
          indexHitLikely: false,
          estimatedRows: 300_000,
          usesTempStructure: false,
          usesFilesort: false,
          riskHints: [],
        };
      },
    },
  });

  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT * FROM users",
    context: makeContext(),
  });

  assert.equal(explainCalls, 1);
  assert.equal(decision.action, "confirm");
  assert.equal(decision.requiresExplain, true);
  assert.equal(decision.requiresConfirmation, true);
  assert.ok(decision.reasonCodes.includes("R007"));
  assert.ok(decision.reasonCodes.includes("R008"));
  assert.ok(decision.reasonCodes.includes("C001"));
});

test("guardrail requires confirmation when explain is needed but executor is unavailable", async () => {
  const guardrail = createGuardrail({
    schemaIntrospector: {
      async describeTable() {
        return makeTableSchema({ table: "users", columns: ["id"] });
      },
    },
  });

  const decision = await guardrail.inspect({
    toolName: "execute_readonly_sql",
    sql: "SELECT id FROM users",
    context: makeContext(),
  });

  assert.equal(decision.action, "confirm");
  assert.equal(decision.requiresExplain, true);
  assert.ok(decision.reasonCodes.includes("G002"));
});
