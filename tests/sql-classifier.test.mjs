import assert from "node:assert/strict";
import test from "node:test";

import { createSqlParser } from "../dist/safety/parser/index.js";
import { classifySql } from "../dist/safety/sql-classifier.js";

function parseOrThrow(parser, sql) {
  const parsed = parser.parse(sql);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.ast;
}

test("sql classifier extracts select facts without decisions", () => {
  const parser = createSqlParser("mysql");
  const sql =
    "SELECT u.id, COUNT(*) AS c FROM demo.users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.status = 'active' GROUP BY u.id ORDER BY u.id DESC LIMIT 10";
  const normalized = parser.normalize(sql);
  const ast = parseOrThrow(parser, sql);

  const cls = classifySql(ast, normalized, "mysql");

  assert.equal(cls.engine, "mysql");
  assert.equal(cls.statementType, "select");
  assert.equal(cls.normalizedSql, normalized.normalizedSql);
  assert.equal(cls.sqlHash, normalized.sqlHash);
  assert.equal(cls.isMultiStatement, false);
  assert.deepEqual(cls.referencedTables, ["demo.users", "orders"]);
  assert.ok(cls.referencedColumns.includes("users.id"));
  assert.ok(cls.referencedColumns.includes("orders.user_id"));
  assert.equal(cls.hasWhere, true);
  assert.equal(cls.hasLimit, true);
  assert.equal(cls.hasJoin, true);
  assert.equal(cls.hasSubquery, false);
  assert.equal(cls.hasOrderBy, true);
  assert.equal(cls.hasAggregate, true);
});

test("sql classifier extracts update facts", () => {
  const parser = createSqlParser("mysql");
  const sql = "UPDATE users SET status = 'x' WHERE id = 1";
  const normalized = parser.normalize(sql);
  const ast = parseOrThrow(parser, sql);

  const cls = classifySql(ast, normalized, "mysql");

  assert.equal(cls.statementType, "update");
  assert.deepEqual(cls.referencedTables, ["users"]);
  assert.deepEqual([...cls.referencedColumns].sort(), ["id", "status"]);
  assert.equal(cls.hasWhere, true);
  assert.equal(cls.hasLimit, false);
  assert.equal(cls.hasJoin, false);
  assert.equal(cls.hasOrderBy, false);
  assert.equal(cls.hasAggregate, false);
});

test("sql classifier marks multi statement as unknown statement type", () => {
  const parser = createSqlParser("mysql");
  const sql = "SELECT 1; UPDATE users SET status = 'x'";
  const normalized = parser.normalize(sql);
  const ast = parseOrThrow(parser, sql);

  const cls = classifySql(ast, normalized, "mysql");

  assert.equal(cls.isMultiStatement, true);
  assert.equal(cls.statementType, "unknown");
  assert.deepEqual(cls.referencedTables, ["users"]);
});

test("sql classifier deduplicates referenced tables/columns case-insensitively", () => {
  const normalized = {
    normalizedSql: "SELECT 1",
    sqlHash: "abc123def4567890",
  };

  const ast = {
    kind: "select",
    tables: [
      { schema: "demo", name: "users" },
      { schema: "demo", name: "Users" },
      { name: "orders" },
      { name: "ORDERS" },
    ],
    columns: [
      { table: "users", name: "id" },
      { table: "users", name: "ID" },
      { name: "created_at" },
      { name: "CREATED_AT" },
    ],
    hasAggregate: false,
    hasSubquery: false,
    isMultiStatement: false,
  };

  const cls = classifySql(ast, normalized, "unknown");

  assert.deepEqual(cls.referencedTables, ["demo.users", "orders"]);
  assert.deepEqual(cls.referencedColumns, ["users.id", "created_at"]);
  assert.equal(cls.engine, "unknown");
});

test("sql classifier works for postgresql engine", () => {
  const parser = createSqlParser("postgresql");
  const sql = "SELECT id FROM public.users LIMIT 5";
  const normalized = parser.normalize(sql);
  const ast = parseOrThrow(parser, sql);

  const cls = classifySql(ast, normalized, "postgresql");

  assert.equal(cls.engine, "postgresql");
  assert.equal(cls.statementType, "select");
  assert.deepEqual(cls.referencedTables, ["public.users"]);
  assert.equal(cls.hasLimit, true);
});
