import assert from "node:assert/strict";
import test from "node:test";

import { createResultRedactor } from "../dist/safety/redaction.js";

test("result redactor applies row/column/field truncation and masking", () => {
  const redactor = createResultRedactor();

  const result = redactor.redact(
    {
      columns: [
        { name: "id" },
        { name: "name" },
        { name: "password" },
        { name: "email" },
        { name: "notes" },
      ],
      rows: [
        [1, "AliceLong", "pw_1", "alice@example.com", "n1"],
        [2, "BobLong", "pw_2", "bob@example.com", "n2"],
        [3, "CathyLong", "pw_3", "cathy@example.com", "n3"],
      ],
      rowCount: 3,
    },
    {
      maxRows: 2,
      maxColumns: 4,
      maxFieldChars: 5,
      sensitiveStrategy: "mask",
    },
  );

  assert.equal(result.truncated, true);
  assert.equal(result.rowTruncated, true);
  assert.equal(result.columnTruncated, true);
  assert.equal(result.fieldTruncated, true);
  assert.equal(result.rowCount, 3);
  assert.equal(result.originalRowCount, 3);
  assert.deepEqual(result.columns.map((column) => column.name), [
    "id",
    "name",
    "password",
    "email",
  ]);
  assert.deepEqual(result.redactedColumns, ["password", "email"]);
  assert.deepEqual(result.droppedColumns, []);
  assert.deepEqual(result.truncatedColumns, ["name"]);
  assert.deepEqual(result.rows, [
    [1, "Alice...[TRUNCATED]", "***", "al***@example.com"],
    [2, "BobLo...[TRUNCATED]", "***", "bo***@example.com"],
  ]);
});

test("result redactor drops sensitive columns when strategy is drop", () => {
  const redactor = createResultRedactor();

  const result = redactor.redact(
    {
      columns: [{ name: "id" }, { name: "token" }, { name: "payload" }],
      rows: [[1, "tok_a", "ok"]],
      rowCount: 1,
    },
    {
      maxRows: 10,
      maxColumns: 10,
      maxFieldChars: 100,
      sensitiveColumns: new Set(["token"]),
      sensitiveStrategy: "drop",
    },
  );

  assert.deepEqual(result.columns.map((column) => column.name), ["id", "payload"]);
  assert.deepEqual(result.rows, [[1, "ok"]]);
  assert.deepEqual(result.redactedColumns, []);
  assert.deepEqual(result.droppedColumns, ["token"]);
  assert.equal(result.truncated, false);
});

test("result redactor hashes sensitive fields when strategy is hash", () => {
  const redactor = createResultRedactor();

  const result = redactor.redact(
    {
      columns: [{ name: "api_token" }, { name: "value" }],
      rows: [
        ["same", "a"],
        ["same", "b"],
      ],
      rowCount: 2,
    },
    {
      maxRows: 10,
      maxColumns: 10,
      maxFieldChars: 100,
      sensitiveStrategy: "hash",
    },
  );

  assert.equal(result.redactedColumns.length, 1);
  assert.equal(result.redactedColumns[0], "api_token");
  assert.match(result.rows[0][0], /^\[HASH:[a-f0-9]{12}\]$/);
  assert.equal(result.rows[0][0], result.rows[1][0]);
});
