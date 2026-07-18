import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  InMemoryConfirmationStore,
  normalizeSql,
  sqlHash,
} from "taurusdb-core";

const entrypoint = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);
const secret = "cli-approval-secret-that-is-at-least-32-bytes";
const context = {
  task_id: "task_cli",
  datasource: "production",
  engine: "mysql",
  database: "orders",
  limits: {
    readonly: false,
    timeoutMs: 5000,
    maxRows: 100,
    maxColumns: 20,
    maxFieldChars: 512,
  },
};

function run(args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: os.tmpdir() },
  });
}

test("approve CLI signs a pending request with an auditable actor", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-approve-"));
  const secretPath = path.join(tempDir, "secret");
  await writeFile(secretPath, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  const sql = "UPDATE orders SET status='approved' WHERE id=1";
  const normalizedSql = normalizeSql(sql);
  const store = new InMemoryConfirmationStore({
    approvalSecret: secret,
    cleanupIntervalMs: 0,
  });
  const approval = await store.issue({
    sqlHash: sqlHash(normalizedSql),
    normalizedSql,
    context,
    riskLevel: "high",
  });

  const result = run([
    "approve",
    "--request",
    approval.request,
    "--actor",
    "dba@example.com",
    "--secret-file",
    secretPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^ctok_/);

  const validation = await store.validate(result.stdout.trim(), sql, context);
  assert.equal(validation.valid, true);
  assert.equal(validation.actor, "dba@example.com");
});

test("approve CLI rejects broadly readable secret files", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX permission bits are not available on Windows.");
    return;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-approve-mode-"));
  const secretPath = path.join(tempDir, "secret");
  await writeFile(secretPath, `${secret}\n`, "utf8");
  await chmod(secretPath, 0o644);
  const result = run([
    "approve",
    "--request",
    "creq_invalid",
    "--actor",
    "dba@example.com",
    "--secret-file",
    secretPath,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be accessible by group or other users/);
});
