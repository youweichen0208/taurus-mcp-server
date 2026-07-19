import assert from "node:assert/strict";
import test from "node:test";

import { SessionCredentialManager } from "../dist/security/session-credential-manager.js";

function harness({ idleTtlMs = 30, maxTtlMs = 100 } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const manager = new SessionCredentialManager({
    idleTtlMs,
    maxTtlMs,
    now: () => now,
    schedule(callback, delayMs) {
      const timer = { id: ++nextId, unref() {} };
      timers.set(timer, { callback, due: now + delayMs });
      return timer;
    },
    cancel(timer) {
      timers.delete(timer);
    },
  });
  return {
    manager,
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, item]) => item.due <= now);
      for (const [timer, item] of due) {
        timers.delete(timer);
        item.callback();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("credential sessions expire after idle timeout", async () => {
  const { manager, advance } = harness();
  const expired = [];
  manager.activate("db", async () => expired.push("db"));
  await advance(29);
  assert.deepEqual(expired, []);
  await advance(1);
  assert.deepEqual(expired, ["db"]);
});

test("activity refreshes idle timeout but not absolute lifetime", async () => {
  const { manager, advance } = harness({ idleTtlMs: 30, maxTtlMs: 70 });
  const expired = [];
  manager.activate("db", async () => expired.push("db"));
  await advance(20);
  manager.touch("db");
  await advance(20);
  manager.touch("db");
  await advance(20);
  assert.deepEqual(expired, []);
  await advance(10);
  assert.deepEqual(expired, ["db"]);
});

test("clearing a credential session cancels expiry", async () => {
  const { manager, advance } = harness();
  const expired = [];
  manager.activate("db", async () => expired.push("db"));
  manager.clear("db");
  await advance(100);
  assert.deepEqual(expired, []);
});
