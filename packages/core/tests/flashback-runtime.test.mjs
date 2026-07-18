import assert from "node:assert/strict";
import test from "node:test";

import { flashbackQuery } from "../dist/engine/runtime.js";
import { FlashbackNoViewError } from "../dist/taurus/flashback.js";

function makeContext() {
  return {
    task_id: "task_flashback_runtime",
    datasource: "taurus_mcp",
    engine: "mysql",
    database: "taurusdb_test",
    limits: {
      readonly: true,
      timeoutMs: 5000,
      maxRows: 100,
      maxColumns: 20,
      maxFieldChars: 256,
    },
  };
}

test("flashbackQuery returns contextual diagnostics when no historical view is available", async () => {
  const ctx = makeContext();
  ctx.database = "db-1";
  const engine = {
    capabilityProbe: {
      async listFeatures() {
        return {
          flashback_query: {
            available: true,
            enabled: true,
            minVersion: "2.0.69.250900",
          },
        };
      },
    },
    executor: {
      async executeReadonly(sql) {
        if (sql.includes("AS OF TIMESTAMP")) {
          throw new Error("No view available for provided TIMESTAMP.");
        }
        if (sql.includes("@@innodb_rds_backquery_window")) {
          return {
            queryId: "qry_env",
            columns: [{ name: "now_time" }, { name: "backquery_window" }],
            rows: [["2026-05-13 11:10:00", "3600"]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 1,
          };
        }
        if (sql.includes("SELECT `updated_at`")) {
          return {
            queryId: "qry_updated_at",
            columns: [{ name: "updated_at" }],
            rows: [["2026-05-13 11:04:39"]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  };

  await assert.rejects(
    flashbackQuery(
      engine,
      {
        database: "db-1",
        table: "t_flashback_query_test",
        asOf: { timestamp: "2026-05-13 11:06:00" },
        where: "id = 1",
      },
      ctx,
    ),
    (error) => {
      assert.equal(error instanceof FlashbackNoViewError, true);
      assert.equal(error.message, "No view available for provided TIMESTAMP.");
      assert.equal(error.details.requested_timestamp, "2026-05-13 11:06:00");
      assert.equal(error.details.current_time, "2026-05-13 11:10:00");
      assert.equal(error.details.backquery_window_seconds, 3600);
      assert.equal(
        error.details.earliest_supported_timestamp_estimate,
        "2026-05-13 10:10:00",
      );
      assert.equal(
        error.details.current_row_updated_at,
        "2026-05-13 11:04:39",
      );
      assert.deepEqual(error.details.recommended_timestamps, [
        "2026-05-13 11:05:59",
        "2026-05-13 11:04:38",
        "2026-05-13 11:04:34",
        "2026-05-13 11:04:09",
        "2026-05-13 11:03:39",
      ]);
      return true;
    },
  );
});

test("flashbackQuery resolves relative timestamps against database current time", async () => {
  const ctx = makeContext();
  const executedSql = [];
  const engine = {
    capabilityProbe: {
      async listFeatures() {
        return {
          flashback_query: {
            available: true,
            enabled: true,
            minVersion: "2.0.69.250900",
          },
        };
      },
    },
    executor: {
      async executeReadonly(sql) {
        executedSql.push(sql);
        if (sql === "SELECT NOW(6) AS now_time") {
          return {
            queryId: "qry_now",
            columns: [{ name: "now_time" }],
            rows: [["2026-05-13 11:30:53.973920"]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 1,
          };
        }
        if (sql.includes("AS OF TIMESTAMP")) {
          return {
            queryId: "qry_flashback",
            columns: [{ name: "id" }],
            rows: [[1]],
            rowCount: 1,
            originalRowCount: 1,
            truncated: false,
            rowTruncated: false,
            columnTruncated: false,
            fieldTruncated: false,
            redactedColumns: [],
            droppedColumns: [],
            truncatedColumns: [],
            durationMs: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  };

  const result = await flashbackQuery(
    engine,
    {
      database: "taurusdb_test",
      table: "t_flashback_query_test",
      asOf: { relative: "20m" },
      where: "id = 1",
    },
    ctx,
  );

  assert.equal(result.rowCount, 1);
  assert.equal(executedSql[0], "SELECT NOW(6) AS now_time");
  assert.match(
    executedSql[1],
    /AS OF TIMESTAMP '2026-05-13 11:10:53'/,
  );
});
