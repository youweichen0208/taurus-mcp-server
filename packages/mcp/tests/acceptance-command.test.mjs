import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { redact } from "../dist/commands/acceptance.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

async function runCli(args, env = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-acceptance-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, ...args], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        TAURUSDB_MCP_LOG_LEVEL: "error",
        TAURUSDB_MCP_AUDIT_LOG_PATH: path.join(dir, "audit.jsonl"),
        ...env,
      },
    });
    return { code: 0, stdout, dir };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, dir };
  }
}

test("acceptance redaction removes endpoints, accounts, and URLs", () => {
  const text = redact("connect to 10.1.2.3:3306 via db.cn-north-4.myhuaweicloud.com as 'app'@'%' user=admin http://127.0.0.1:5555/sql-login/abc");
  assert.doesNotMatch(text, /10\.1\.2\.3|myhuaweicloud|'app'|admin|sql-login|abc/);
});

test("acceptance without a database target reports pending, never accepted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-acceptance-report-"));
  const report = path.join(dir, "report.json");
  const result = await runCli(["acceptance", "--report", report]);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /\[pass\] MCP initialize/);
  assert.match(result.stdout, /\[pending\] Readonly query/);
  assert.match(result.stdout, /Acceptance incomplete/);
  const parsed = JSON.parse(await readFile(report, "utf8"));
  assert.equal(parsed.outcome, "incomplete");
  assert.ok(parsed.checks.some((check) => check.status === "pending"));
  assert.ok(parsed.checks.every((check) => check.status !== "fail"));
});

test("acceptance refuses a restore without explicit disposable confirmation", async () => {
  const result = await runCli([
    "acceptance",
    "--restore-recycle-table", "x",
    "--restore-destination-database", "d",
    "--restore-destination-table", "t",
  ], {
    TAURUSDB_SQL_PROFILES: path.join(os.tmpdir(), "does-not-exist.json"),
  });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /\[pass\] Recycle-bin recovery/);
});

test("CLI help lists the acceptance command", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /acceptance/);
  const acceptance = await runCli(["acceptance", "--help"]);
  assert.match(acceptance.stdout, /--confirm-disposable-restore/);
});
