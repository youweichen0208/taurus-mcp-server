import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCost,
  validateSchemaAware,
  validateStaticRules,
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

test("validateSchemaAware blocks missing table", () => {
  const cls = baseClassification({
    referencedTables: ["orders"],
    referencedColumns: ["id"],
  });
  const snapshot = new Map([["demo.users", makeTableSchema()]]);
  const result = validateSchemaAware(cls, snapshot);

  assert.equal(result.action, "block");
  assert.deepEqual(result.reasonCodes, ["R009"]);
});

test("validateSchemaAware blocks missing column", () => {
  const cls = baseClassification({
    referencedTables: ["users"],
    referencedColumns: ["users.phone_number"],
  });
  const snapshot = new Map([["demo.users", makeTableSchema({ columns: ["id", "email"] })]]);
  const result = validateSchemaAware(cls, snapshot);

  assert.equal(result.action, "block");
  assert.deepEqual(result.reasonCodes, ["R010"]);
});

test("validateSchemaAware marks sensitive column access as medium allow", () => {
  const cls = baseClassification({
    referencedTables: ["users"],
    referencedColumns: ["users.phone_number"],
  });
  const snapshot = new Map([
    [
      "demo.users",
      makeTableSchema({ columns: ["id", "phone_number"], sensitive: ["phone_number"] }),
    ],
  ]);
  const result = validateSchemaAware(cls, snapshot);

  assert.equal(result.action, "allow");
  assert.equal(result.riskLevel, "medium");
  assert.deepEqual(result.reasonCodes, ["R011"]);
});

test("validateCost returns confirm for likely full scan with high rows", () => {
  const cls = baseClassification({ statementType: "select" });
  const result = validateCost(cls, {
    fullTableScanLikely: true,
    indexHitLikely: false,
    estimatedRows: 500_000,
    usesTempStructure: false,
    usesFilesort: false,
    riskHints: [],
  });

  assert.equal(result.action, "confirm");
  assert.equal(result.riskLevel, "high");
  assert.ok(result.reasonCodes.includes("C001"));
});

test("validateCost returns medium allow for filesort/temp usage", () => {
  const cls = baseClassification({ statementType: "select" });
  const result = validateCost(cls, {
    fullTableScanLikely: false,
    indexHitLikely: true,
    estimatedRows: 20_000,
    usesTempStructure: true,
    usesFilesort: true,
    riskHints: ["Using temporary"],
  });

  assert.equal(result.action, "allow");
  assert.equal(result.riskLevel, "medium");
  assert.ok(result.reasonCodes.includes("C003"));
  assert.ok(result.reasonCodes.includes("C004"));
});
