import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canonicalDocs = [
  new URL("../../../README.md", import.meta.url),
  new URL("../../../docs/architecture.md", import.meta.url),
  new URL("../../../docs/cloud-taurusdb-testing.md", import.meta.url),
  new URL("../../../docs/customer-deployment.md", import.meta.url),
  new URL("../../../docs/release-readiness.md", import.meta.url),
  new URL("../../../docs/scale-validation.md", import.meta.url),
  new URL("../../../docs/taurusdb-ops-playbook.md", import.meta.url),
  new URL("../../../docs/testing.md", import.meta.url),
  new URL("../README.md", import.meta.url),
];

test("canonical documentation does not advertise obsolete mutation security", async () => {
  const documents = await Promise.all(
    canonicalDocs.map(async (url) => ({
      name: url.pathname,
      text: await readFile(url, "utf8"),
    })),
  );

  const forbiddenClaims = [
    "MCP 不再区分 `readonly user` / `mutation user`",
    "`execute_sql` 默认暴露",
    "`restore_recycle_bin_table` 默认暴露",
    "执行恢复时复用 datasource 配置中的数据库账号",
    "启动时同时校验独立 mutation user 和 approval secret",
  ];

  for (const { name, text } of documents) {
    for (const claim of forbiddenClaims) {
      assert.equal(text.includes(claim), false, `${name} contains obsolete claim: ${claim}`);
    }
  }
});

test("customer documentation contains no developer-specific paths or addresses", async () => {
  const documents = await Promise.all(
    canonicalDocs.map(async (url) => ({
      name: url.pathname,
      text: await readFile(url, "utf8"),
    })),
  );
  const forbiddenPatterns = [
    /\/Users\/[A-Za-z0-9._-]+\//,
    /\/home\/[A-Za-z0-9._-]+\//,
    /124\.70\.231\.48/,
    /TAURUSDB_PROFILES_PATH/,
    /TAURUSDB_AUDIT_LOG_PATH/,
    /TAURUSDB_MAX_(?:ROWS|COLUMNS|STATEMENT_MS)/,
  ];

  for (const { name, text } of documents) {
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(text, pattern, `${name} contains developer-specific or obsolete configuration`);
    }
  }
});

test("release documentation describes the external approval boundary", async () => {
  const rootReadme = await readFile(canonicalDocs[0], "utf8");
  const cloudGuide = await readFile(canonicalDocs[2], "utf8");
  const architecture = await readFile(canonicalDocs[1], "utf8");

  for (const required of [
    "TAURUSDB_CLOUD_KEYCHAIN_SERVICE",
    "TAURUSDB_ENABLE_MUTATIONS=true",
    "TAURUSDB_SQL_MUTATION_USER",
    "TAURUSDB_MUTATION_APPROVAL_SECRET_FILE",
    "approval_request",
    "approval_token",
  ]) {
    assert.ok(rootReadme.includes(required), `root README must document ${required}`);
    assert.ok(cloudGuide.includes(required), `cloud guide must document ${required}`);
  }

  for (const required of [
    "TAURUSDB_MCP_AUDIT_LOG_PATH",
    "TAURUSDB_MCP_AUDIT_MAX_BYTES",
    "TAURUSDB_MCP_AUDIT_MAX_FILES",
  ]) {
    assert.ok(rootReadme.includes(required), `root README must document ${required}`);
  }

  assert.match(
    architecture,
    /"approval_request": "creq_[^"]+"/,
    "architecture response example must return an unsigned approval request",
  );
  assert.doesNotMatch(
    architecture,
    /"approval_token": "ctok_[^"]+"/,
    "architecture must not claim that the MCP server issues approval tokens",
  );
});
