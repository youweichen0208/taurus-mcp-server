import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFlashbackSql,
  resolveRelativeTimestampFromBase,
  resolveFlashbackTimestamp,
} from "../dist/taurus/flashback.js";

test("resolveFlashbackTimestamp preserves SQL timestamp literals without timezone conversion", () => {
  assert.equal(
    resolveFlashbackTimestamp({
      timestamp: "2026-05-13 10:32:29.177525",
    }),
    "2026-05-13 10:32:29",
  );

  assert.equal(
    resolveFlashbackTimestamp({
      timestamp: "2026-05-13T10:32:29.177525",
    }),
    "2026-05-13 10:32:29",
  );
});

test("buildFlashbackSql keeps database-local timestamp values in AS OF TIMESTAMP", () => {
  const sql = buildFlashbackSql(
    {
      database: "taurusdb_test",
      table: "t_flashback_query_test",
      asOf: {
        timestamp: "2026-05-13 10:32:29.177525",
      },
      where: "id = 1",
      columns: ["id", "status", "updated_at"],
      limit: 1,
    },
    "ignored_default",
  );

  assert.equal(
    sql,
    "SELECT `id`, `status`, `updated_at` FROM `taurusdb_test`.`t_flashback_query_test` AS OF TIMESTAMP '2026-05-13 10:32:29' WHERE (id = 1) LIMIT 1",
  );
});

test("buildFlashbackSql supports database names containing hyphens", () => {
  const sql = buildFlashbackSql(
    {
      database: "db-1",
      table: "orders",
      asOf: { timestamp: "2026-05-13 10:32:29" },
    },
    "ignored_default",
  );

  assert.equal(
    sql,
    "SELECT * FROM `db-1`.`orders` AS OF TIMESTAMP '2026-05-13 10:32:29'",
  );
});

test("buildFlashbackSql rejects multi-statement where clauses", () => {
  assert.throws(
    () =>
      buildFlashbackSql(
        {
          table: "orders",
          asOf: { timestamp: "2026-05-13 10:32:29" },
          where: "id = 1); DELETE FROM orders WHERE (1 = 1",
        },
        "app",
      ),
    /Invalid flashback where clause/,
  );
});

test("buildFlashbackSql strips executable comments from where clauses", () => {
  const sql = buildFlashbackSql(
    {
      table: "orders",
      asOf: { timestamp: "2026-05-13 10:32:29" },
      where: "id = 1 /*! OR 1 = 1 */",
    },
    "app",
  );

  assert.equal(
    sql,
    "SELECT * FROM `app`.`orders` AS OF TIMESTAMP '2026-05-13 10:32:29' WHERE (id = 1)",
  );
});

test("resolveRelativeTimestampFromBase keeps database-local wall clock semantics", () => {
  assert.equal(
    resolveRelativeTimestampFromBase(
      "20m",
      "2026-05-13 11:30:53.973920",
    ),
    "2026-05-13 11:10:53",
  );
});
