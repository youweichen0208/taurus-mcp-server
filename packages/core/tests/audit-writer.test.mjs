import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";

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

test("JSONL audit writer rotates concurrent events without corrupting records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-audit-rotate-"));
  const logPath = path.join(dir, "audit.jsonl");
  const sample = {
    timestamp: "2026-07-19T00:00:00.000Z",
    task_id: "task_000",
    tool: "execute_readonly_sql",
    actor: "mcp:test-client@1.0.0",
    datasource: "prod",
    database: "orders",
    sql_hash: "sha256:abc",
    decision: "allowed",
    outcome: "success",
    duration_ms: 12,
  };
  const lineBytes = Buffer.byteLength(`${JSON.stringify(sample)}\n`, "utf8");
  const writer = await createJsonlAuditWriter({
    logPath,
    maxBytes: lineBytes * 5,
    maxFiles: 50,
    syncWrites: false,
  });

  await Promise.all(
    Array.from({ length: 200 }, (_, index) => writer.write({
      ...sample,
      task_id: `task_${String(index).padStart(3, "0")}`,
    })),
  );
  await writer.close();

  const files = (await readdir(dir))
    .filter((name) => name === "audit.jsonl" || name.startsWith("audit.jsonl."));
  const records = [];
  for (const file of files) {
    const content = (await readFile(path.join(dir, file), "utf8")).trim();
    if (content) {
      records.push(...content.split("\n").map((line) => JSON.parse(line)));
    }
  }

  assert.equal(records.length, 200);
  assert.equal(new Set(records.map((event) => event.task_id)).size, 200);
  assert.equal(files.length > 1, true);
  if (process.platform !== "win32") {
    for (const file of files) {
      assert.equal((await stat(path.join(dir, file))).mode & 0o077, 0);
    }
  }
});
