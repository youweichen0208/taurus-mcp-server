import assert from "node:assert/strict";
import test from "node:test";

import {
  QueryConcurrencyError,
  QueryConcurrencyLimiter,
} from "../dist/executor/concurrency-limiter.js";

test("query concurrency limiter queues within bounds and releases capacity", async () => {
  const limiter = new QueryConcurrencyLimiter(1, 1, 1000);
  let releaseFirst;
  const first = limiter.run(
    () => new Promise((resolve) => {
      releaseFirst = resolve;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  let secondStarted = false;
  const second = limiter.run(async () => {
    secondStarted = true;
    return "second";
  });
  await assert.rejects(
    () => limiter.run(async () => "third"),
    QueryConcurrencyError,
  );
  assert.equal(secondStarted, false);
  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});

test("query concurrency limiter times out queued work", async () => {
  const limiter = new QueryConcurrencyLimiter(1, 1, 5);
  let releaseFirst;
  const first = limiter.run(
    () => new Promise((resolve) => {
      releaseFirst = resolve;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => limiter.run(async () => "queued"),
    /Timed out waiting for query capacity/,
  );
  releaseFirst();
  await first;
});

test("query concurrency limiter keeps a sustained burst within the active cap", async () => {
  const maxConcurrent = 8;
  const limiter = new QueryConcurrencyLimiter(maxConcurrent, 192, 5000);
  let active = 0;
  let peakActive = 0;

  const results = await Promise.all(
    Array.from({ length: 200 }, (_, index) => limiter.run(async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, index % 3));
      active -= 1;
      return index;
    })),
  );

  assert.deepEqual(results, Array.from({ length: 200 }, (_, index) => index));
  assert.equal(peakActive, maxConcurrent);
  assert.equal(active, 0);
});
