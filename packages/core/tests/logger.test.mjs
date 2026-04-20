import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";

import { createLogger, withTaskContext } from "../dist/utils/logger.js";

class CaptureStream extends Writable {
  #chunks = [];

  _write(chunk, _encoding, callback) {
    this.#chunks.push(chunk.toString("utf8"));
    callback();
  }

  lines() {
    return this.#chunks
      .join("")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

test("logger injects task_id from async context", async () => {
  const stream = new CaptureStream();
  const logger = createLogger(stream);

  await withTaskContext("task_test_001", async () => {
    logger.info({ tool: "ping" }, "test message");
  });

  const [line] = stream.lines();
  assert.ok(line, "expected one log line");

  const log = JSON.parse(line);
  assert.equal(log.task_id, "task_test_001");
  assert.equal(log.tool, "ping");
  assert.equal(log.msg, "test message");
});

test("logger redacts sensitive fields", async () => {
  const stream = new CaptureStream();
  const logger = createLogger(stream);

  await withTaskContext("task_test_002", async () => {
    logger.info(
      {
        password: "plain",
        token: "abc",
        credentials: { password: "p1", token: "p2", apiKey: "keep" },
      },
      "redaction test",
    );
  });

  const [line] = stream.lines();
  assert.ok(line, "expected one log line");

  const log = JSON.parse(line);
  assert.equal(log.password, "[REDACTED]");
  assert.equal(log.token, "[REDACTED]");
  assert.equal(log.credentials.password, "[REDACTED]");
  assert.equal(log.credentials.token, "[REDACTED]");
  assert.equal(log.credentials.apiKey, "[REDACTED]");
});
