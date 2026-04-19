import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryQueryTracker } from "../dist/executor/query-tracker.js";

function makeInfo({
  queryId = "qry_1",
  status = "running",
  startedAt = 1000,
  mode = "ro",
} = {}) {
  return {
    queryId,
    taskId: "task_1",
    datasource: "local_mysql",
    mode,
    status,
    startedAt,
  };
}

test("query tracker register/get returns stored query info", () => {
  const tracker = new InMemoryQueryTracker({ historyLimit: 10, now: () => 10_000 });
  tracker.register("qry_1", makeInfo());

  const info = tracker.get("qry_1");
  assert.ok(info);
  assert.equal(info.queryId, "qry_1");
  assert.equal(info.status, "running");
});

test("query tracker markCompleted updates status and duration", () => {
  let now = 2000;
  const tracker = new InMemoryQueryTracker({ now: () => now, historyLimit: 10 });
  tracker.register("qry_1", makeInfo({ startedAt: 1000 }));

  now = 2300;
  tracker.markCompleted("qry_1", { status: "completed" });
  const info = tracker.get("qry_1");

  assert.ok(info);
  assert.equal(info.status, "completed");
  assert.equal(info.endedAt, 2300);
  assert.equal(info.durationMs, 1300);
});

test("query tracker listActive only returns running queries", () => {
  const tracker = new InMemoryQueryTracker({ historyLimit: 10, now: () => 10_000 });
  tracker.register("qry_1", makeInfo({ queryId: "qry_1", status: "running", startedAt: 2000 }));
  tracker.register("qry_2", makeInfo({ queryId: "qry_2", status: "running", startedAt: 1000 }));
  tracker.register("qry_3", makeInfo({ queryId: "qry_3", status: "completed", startedAt: 1500 }));

  const active = tracker.listActive();
  assert.deepEqual(active.map((item) => item.queryId), ["qry_2", "qry_1"]);
});

test("query tracker cleanup removes old completed entries and keeps running", () => {
  let now = 10_000;
  const tracker = new InMemoryQueryTracker({ now: () => now, historyLimit: 10 });

  tracker.register("qry_run", makeInfo({ queryId: "qry_run", status: "running", startedAt: 9000 }));
  tracker.register("qry_old", makeInfo({ queryId: "qry_old", status: "completed", startedAt: 1000 }));
  tracker.markCompleted("qry_old", { status: "completed", endedAt: 2000, durationMs: 1000 });

  tracker.register("qry_new", makeInfo({ queryId: "qry_new", status: "completed", startedAt: 8000 }));
  tracker.markCompleted("qry_new", { status: "completed", endedAt: 9000, durationMs: 1000 });

  now = 10_500;
  tracker.cleanup(5_000);

  assert.ok(tracker.get("qry_run"));
  assert.equal(tracker.get("qry_old"), undefined);
  assert.ok(tracker.get("qry_new"));
});

test("query tracker historyLimit evicts oldest completed entries first", () => {
  const tracker = new InMemoryQueryTracker({ historyLimit: 2, now: () => 10_000 });

  tracker.register("qry_running", makeInfo({ queryId: "qry_running", status: "running", startedAt: 9000 }));
  tracker.register("qry_a", makeInfo({ queryId: "qry_a", status: "completed", startedAt: 1000 }));
  tracker.markCompleted("qry_a", { status: "completed", endedAt: 2000, durationMs: 1000 });
  tracker.register("qry_b", makeInfo({ queryId: "qry_b", status: "completed", startedAt: 3000 }));
  tracker.markCompleted("qry_b", { status: "completed", endedAt: 4000, durationMs: 1000 });

  assert.equal(tracker.get("qry_a"), undefined);
  assert.ok(tracker.get("qry_b"));
  assert.ok(tracker.get("qry_running"));
});
