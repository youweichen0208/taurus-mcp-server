import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat } from "node:fs/promises";

import { createJsonlAuditWriter } from "../dist/index.js";

test("JSONL audit writer creates a private durable log and serializes events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-audit-"));
  const logPath = path.join(dir, "nested", "audit.jsonl");
  const writer = await createJsonlAuditWriter({ logPath });
  await writer.write({
    timestamp: "2026-07-18T00:00:00.000Z",
    task_id: "task_1",
    tool: "execute_sql",
    actor: "operator@example.com",
    datasource: "prod",
    database: "orders",
    sql_hash: "sha256:abc",
    decision: "allowed",
    outcome: "success",
    duration_ms: 12,
  });
  await writer.close();

  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).actor, "operator@example.com");
  if (process.platform !== "win32") {
    assert.equal((await stat(logPath)).mode & 0o077, 0);
  }
});

test("JSONL audit writer refuses symlink log targets", async () => {
  if (process.platform === "win32") {
    return;
  }
  const { symlink, writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-audit-link-"));
  const target = path.join(dir, "target");
  const link = path.join(dir, "audit.jsonl");
  await writeFile(target, "");
  await symlink(target, link);
  await assert.rejects(() => createJsonlAuditWriter({ logPath: link }));
});
