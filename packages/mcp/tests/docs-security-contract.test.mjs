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
  new URL("../../../docs/manual-smoke-test.md", import.meta.url),
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
    "execute_sql",
    "restore_recycle_bin_table",
    "TAURUSDB_ENABLE_MUTATIONS",
    "TAURUSDB_SQL_MUTATION_USER",
    "mutationUser",
    "approval_request",
    "approval_token",
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

test("release documentation describes the non-executing SQL Advice boundary", async () => {
  const rootReadme = await readFile(canonicalDocs[0], "utf8");
  const cloudGuide = await readFile(canonicalDocs[2], "utf8");
  const architecture = await readFile(canonicalDocs[1], "utf8");

  for (const required of ["analyze_mutation_sql", "not_executed", "human_review_required"]) {
    assert.ok(rootReadme.includes(required), `root README must document ${required}`);
    assert.ok(cloudGuide.includes(required), `cloud guide must document ${required}`);
    assert.ok(architecture.includes(required), `architecture must document ${required}`);
  }

  for (const required of [
    "TAURUSDB_MCP_AUDIT_LOG_PATH",
    "TAURUSDB_MCP_AUDIT_MAX_BYTES",
    "TAURUSDB_MCP_AUDIT_MAX_FILES",
  ]) {
    assert.ok(rootReadme.includes(required), `root README must document ${required}`);
  }

  assert.match(architecture, /Agent 日常操作面永不执行任意 DML/);
  assert.match(cloudGuide, /记录未变化/);
});

test("customer documentation describes the narrow human-gated recovery exception", async () => {
  const documents = await Promise.all(
    canonicalDocs.map(async (url) => readFile(url, "utf8")),
  );
  const joined = documents.join("\n");
  for (const required of [
    "prepare_recycle_bin_restore",
    "get_recycle_bin_restore_status",
  ]) {
    assert.ok(joined.includes(required), `customer documentation must describe ${required}`);
  }
  assert.match(joined, /唯一受控例外/);
  assert.match(joined, /Agent 不能直接/);
  assert.doesNotMatch(joined, /TAURUSDB_SQL_RECOVERY_(?:USER|PASSWORD)/);
  assert.doesNotMatch(joined, /TAURUSDB_RECOVERY_APPROVAL_SECRET_FILE/);
});
