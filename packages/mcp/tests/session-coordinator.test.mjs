import assert from "node:assert/strict";
import test from "node:test";

import { SessionCoordinator } from "../dist/security/session-coordinator.js";

test("session coordinator waits for readers before applying an exclusive target swap", async () => {
  const coordinator = new SessionCoordinator();
  const events = [];
  let releaseReader;
  const reader = coordinator.runShared(async () => {
    events.push("reader-start");
    await new Promise((resolve) => {
      releaseReader = resolve;
    });
    events.push("reader-end");
  });
  await new Promise((resolve) => setImmediate(resolve));
  const writer = coordinator.runExclusive(async () => {
    events.push("writer");
  });
  const lateReader = coordinator.runShared(async () => {
    events.push("late-reader");
  });

  releaseReader();
  await Promise.all([reader, writer, lateReader]);
  assert.deepEqual(events, [
    "reader-start",
    "reader-end",
    "writer",
    "late-reader",
  ]);
});
