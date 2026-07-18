import assert from "node:assert/strict";
import test from "node:test";

import {
  validateStaticRules,
  validateDatabaseScope,
  validateToolScope,
} from "../dist/safety/sql-validator.js";

function baseClassification(overrides = {}) {
  return {
    engine: "mysql",
    statementType: "select",
    normalizedSql: "SELECT id FROM users LIMIT 10",
    sqlHash: "abc123def4567890",
    isMultiStatement: false,
    referencedTables: ["users"],
    referencedSchemas: [],
    referencedColumns: ["id"],
    hasWhere: false,
    hasLimit: true,
    hasJoin: false,
    hasSubquery: false,
    hasOrderBy: false,
    hasAggregate: false,
    ...overrides,
  };
}

test("validateToolScope blocks mutation SQL in execute_readonly_sql", () => {
  const cls = baseClassification({ statementType: "update" });
  const result = validateToolScope("execute_readonly_sql", cls);

  assert.equal(result.action, "block");
  assert.deepEqual(result.reasonCodes, ["T001"]);
});

test("validateToolScope blocks readonly SQL in execute_sql", () => {
  const cls = baseClassification({ statementType: "select" });
  const result = validateToolScope("execute_sql", cls);

  assert.equal(result.action, "block");
  assert.deepEqual(result.reasonCodes, ["T002"]);
});

test("validateStaticRules blocks multi-statement SQL", () => {
  const cls = baseClassification({ isMultiStatement: true, statementType: "unknown" });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "block");
  assert.equal(result.riskLevel, "blocked");
  assert.ok(result.reasonCodes.includes("R001"));
});

test("validateStaticRules blocks update without where", () => {
  const cls = baseClassification({
    statementType: "update",
    normalizedSql: "UPDATE users SET status = 'x'",
    hasWhere: false,
  });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "block");
  assert.ok(result.reasonCodes.includes("R005"));
});

test("validateStaticRules confirms update with where", () => {
  const cls = baseClassification({
    statementType: "update",
    normalizedSql: "UPDATE users SET status = 'x' WHERE id = 1",
    hasWhere: true,
  });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "confirm");
  assert.equal(result.riskLevel, "high");
  assert.ok(result.reasonCodes.includes("R006"));
});

test("validateStaticRules confirms insert, replace, and upsert classifications", () => {
  const result = validateStaticRules(baseClassification({
    statementType: "insert",
    normalizedSql: "INSERT INTO users (id) VALUES (1)",
  }));
  assert.equal(result.action, "confirm");
  assert.ok(result.reasonCodes.includes("R006"));
});

test("validateStaticRules blocks readonly SQL with side effects", () => {
  for (const sql of [
    "SELECT GET_LOCK('release', 10)",
    "SELECT SLEEP(10)",
    "SELECT * FROM users INTO OUTFILE '/tmp/users'",
    "SELECT * FROM users FOR UPDATE",
  ]) {
    const result = validateStaticRules(baseClassification({ normalizedSql: sql }));
    assert.equal(result.action, "block", sql);
    assert.ok(result.reasonCodes.includes("R009"), sql);
  }
});

test("validateDatabaseScope blocks explicit cross-database references", () => {
  const result = validateDatabaseScope(
    baseClassification({ referencedSchemas: ["tenant_b"] }),
    "tenant_a",
  );
  assert.equal(result.action, "block");
  assert.ok(result.reasonCodes.includes("D002"));
});

test("validateDatabaseScope allows the bound database", () => {
  const result = validateDatabaseScope(
    baseClassification({ referencedSchemas: ["tenant_a"] }),
    "tenant_a",
  );
  assert.equal(result.action, "allow");
});

test("validateStaticRules returns medium risk for detail select without limit and select star", () => {
  const cls = baseClassification({
    statementType: "select",
    normalizedSql: "SELECT * FROM users",
    hasLimit: false,
    hasAggregate: false,
    referencedColumns: ["(.*)"],
  });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "allow");
  assert.equal(result.riskLevel, "medium");
  assert.ok(result.reasonCodes.includes("R007"));
  assert.ok(result.reasonCodes.includes("R008"));
});

test("validateStaticRules does not apply R007 for aggregate select without limit", () => {
  const cls = baseClassification({
    statementType: "select",
    normalizedSql: "SELECT count(*) FROM users",
    hasLimit: false,
    hasAggregate: true,
    referencedColumns: [],
  });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "allow");
  assert.equal(result.riskLevel, "low");
  assert.equal(result.reasonCodes.length, 0);
});

test("validateStaticRules blocks SET GLOBAL", () => {
  const cls = baseClassification({
    statementType: "set",
    normalizedSql: "SET GLOBAL max_connections = 1000",
  });
  const result = validateStaticRules(cls);

  assert.equal(result.action, "block");
  assert.ok(result.reasonCodes.includes("R004"));
});
