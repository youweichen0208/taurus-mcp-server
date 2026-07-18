import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseReplicationLag } from "../dist/diagnostics/replication-lag.js";

const context = {
  task_id: "task_replication",
  datasource: "replica",
  engine: "mysql",
  database: "app",
  limits: {
    readonly: true,
    timeoutMs: 1000,
    maxRows: 20,
    maxColumns: 80,
    maxFieldChars: 512,
  },
};

test("replication-lag diagnosis reports delayed or stopped workers", async () => {
  const executor = {
    async executeReadonly(sql) {
      assert.equal(sql, "SHOW REPLICA STATUS");
      return {
        queryId: "q1",
        columns: [
          { name: "Channel_Name" },
          { name: "Seconds_Behind_Source" },
          { name: "Replica_IO_Running" },
          { name: "Replica_SQL_Running" },
        ],
        rows: [["default", 420, "Yes", "No"]],
        rowCount: 1,
        originalRowCount: 1,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        byteTruncated: false,
        returnedBytes: 10,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 1,
      };
    },
  };
  const result = await diagnoseReplicationLag(executor, {}, context);
  assert.equal(result.status, "inconclusive");
  assert.equal(result.severity, "high");
  assert.equal(
    result.rootCauseCandidates.some((candidate) =>
      candidate.code === "replication_worker_stopped"),
    true,
  );
});

test("replication-lag diagnosis returns not_applicable without a visible channel", async () => {
  const executor = {
    async executeReadonly() {
      return {
        queryId: "q1",
        columns: [],
        rows: [],
        rowCount: 0,
        originalRowCount: 0,
        truncated: false,
        rowTruncated: false,
        columnTruncated: false,
        fieldTruncated: false,
        byteTruncated: false,
        returnedBytes: 0,
        redactedColumns: [],
        droppedColumns: [],
        truncatedColumns: [],
        durationMs: 1,
      };
    },
  };
  const result = await diagnoseReplicationLag(executor, {}, context);
  assert.equal(result.status, "not_applicable");
});
