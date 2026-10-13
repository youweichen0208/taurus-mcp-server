#!/usr/bin/env node
// Fails when the root package, both workspaces, the MCP -> Core dependency, and
// package-lock.json disagree on the release version. Optionally checks a tag.
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const root = read("package.json");
const core = read("packages/core/package.json");
const mcp = read("packages/mcp/package.json");
const lock = read("package-lock.json");

const expected = root.version;
const checks = [
  ["packages/core/package.json version", core.version],
  ["packages/mcp/package.json version", mcp.version],
  ["taurusdb-mcp dependency on taurusdb-core", mcp.dependencies?.["taurusdb-core"]],
  ["package-lock.json root version", lock.version],
  ["package-lock.json root package version", lock.packages?.[""]?.version],
  ["package-lock.json packages/core version", lock.packages?.["packages/core"]?.version],
  ["package-lock.json packages/mcp version", lock.packages?.["packages/mcp"]?.version],
  [
    "package-lock.json packages/mcp dependency on taurusdb-core",
    lock.packages?.["packages/mcp"]?.dependencies?.["taurusdb-core"],
  ],
];

const tag = process.argv[2];
if (tag) {
  checks.push(["release tag", tag.replace(/^v/, "")]);
}

const mismatches = checks.filter(([, value]) => value !== expected);
if (mismatches.length > 0) {
  for (const [label, value] of mismatches) {
    console.error(`Version mismatch: ${label} is ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}.`);
  }
  process.exit(1);
}
console.log(`All release versions agree on ${expected}.`);
