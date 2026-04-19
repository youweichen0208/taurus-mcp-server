import assert from "node:assert/strict";
import test from "node:test";

import { createSqlParser } from "../dist/safety/parser/index.js";

test("sql parser normalizes SQL and produces stable hash format", () => {
  const parser = createSqlParser("mysql");
  const normalized = parser.normalize("  select  *   from users -- comment\n where id = 1; ");

  assert.equal(normalized.normalizedSql, "SELECT * FROM users WHERE id = 1");
  assert.match(normalized.sqlHash, /^[a-f0-9]{16}$/);
});

test("sql parser builds IR for mysql select with joins/where/order/limit", () => {
  const parser = createSqlParser("mysql");
  const sql =
    "SELECT u.id, COUNT(*) AS c FROM demo.users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.status = 'active' GROUP BY u.id ORDER BY u.id DESC LIMIT 10";
  const parsed = parser.parse(sql);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.isMultiStatement, false);
  assert.equal(parsed.ast.kind, "select");
  assert.equal(parsed.ast.hasAggregate, true);
  assert.equal(parsed.ast.hasSubquery, false);
  assert.equal(parsed.ast.where?.kind, "binary");
  assert.equal(parsed.ast.limit?.rowCount, 10);
  assert.equal(parsed.ast.joins?.length, 1);
  assert.equal(parsed.ast.orderBy?.length, 1);
  assert.equal(parsed.ast.groupBy?.length, 1);

  assert.deepEqual(parsed.ast.tables, [
    { schema: "demo", name: "users" },
    { schema: undefined, name: "orders" },
  ]);
  assert.ok(parsed.ast.columns.some((column) => column.name === "id"));
  assert.ok(parsed.ast.columns.some((column) => column.name === "user_id"));
});

test("sql parser detects subquery in select", () => {
  const parser = createSqlParser("mysql");
  const parsed = parser.parse(
    "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE status = 'paid')",
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.ast.kind, "select");
  assert.equal(parsed.ast.hasSubquery, true);
});

test("sql parser marks multi-statement SQL", () => {
  const parser = createSqlParser("mysql");
  const parsed = parser.parse("SELECT 1; SELECT 2;");

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.isMultiStatement, true);
  assert.equal(parsed.ast.isMultiStatement, true);
  assert.equal(parsed.ast.kind, "unknown");
});

test("sql parser supports postgresql parser selection", () => {
  const parser = createSqlParser("postgresql");
  const parsed = parser.parse("SELECT id FROM public.users LIMIT 5");

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  assert.equal(parsed.ast.kind, "select");
  assert.deepEqual(parsed.ast.tables, [{ schema: "public", name: "users" }]);
  assert.equal(parsed.ast.limit?.rowCount, 5);
});

test("sql parser returns parse error details on invalid SQL", () => {
  const parser = createSqlParser("mysql");
  const parsed = parser.parse("SELECT FROM");

  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    return;
  }

  assert.equal(parsed.error.code, "SQL_PARSE_ERROR");
  assert.ok(parsed.error.message.length > 0);
  assert.equal(parsed.error.position?.line, 1);
  assert.ok((parsed.error.position?.column ?? 0) > 0);
});
