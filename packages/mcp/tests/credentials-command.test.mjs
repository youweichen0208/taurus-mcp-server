import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entrypoint = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

function run(args, env = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: os.tmpdir(),
      ...env,
    },
  });
}

test("credentials configure help is available from the published CLI", () => {
  const result = run(["credentials", "configure", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /taurusdb-mcp credentials configure/);
});

test("CLI version matches the published package version", () => {
  const result = run(["--version"]);
  const packageMetadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageMetadata.version);
});

test("credentials check help is available from the published CLI", () => {
  const result = run(["credentials", "check", "--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /taurusdb-mcp credentials check/);
});

test("credentials check reports an unconfigured identity without starting MCP", () => {
  const result = run(["credentials", "check"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /No IAM token, AK\/SK, or system credential store/);
  assert.doesNotMatch(result.stderr, /Starting MCP server/);
});

test("credentials check accepts configured identity and project without network access", () => {
  const result = run(["credentials", "check"], {
    TAURUSDB_CLOUD_REGION: "cn-north-4",
    TAURUSDB_CLOUD_PROJECT_ID: "project-test",
    TAURUSDB_CLOUD_ACCESS_KEY_ID: "ak-test",
    TAURUSDB_CLOUD_SECRET_ACCESS_KEY: "sk-test",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Huawei Cloud identity source: AK\/SK configured/);
  assert.match(result.stdout, /Huawei Cloud project: configured/);
});
