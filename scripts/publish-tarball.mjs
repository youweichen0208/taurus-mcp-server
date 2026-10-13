#!/usr/bin/env node
// Publishes one prebuilt tarball idempotently:
//   - if the version is not on npm, publish exactly this tarball with provenance;
//   - if it is already on npm with the same integrity, skip (safe re-run);
//   - if it is on npm with different content, fail: published versions are
//     never overwritten.
// Then waits until the registry serves the version with the expected integrity.
//
// Usage: node scripts/publish-tarball.mjs <package.tgz> <dist-tag>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const [tarballArg, distTag] = process.argv.slice(2);
if (!tarballArg || !distTag) {
  console.error("Usage: node scripts/publish-tarball.mjs <package.tgz> <dist-tag>");
  process.exit(2);
}

// npm treats a bare relative spec such as "release/pkg.tgz" as GitHub
// shorthand (owner/repo) and tries to clone it, so always pass an absolute path.
const tarball = path.resolve(tarballArg);

const manifest = JSON.parse(
  execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" }),
);
const spec = `${manifest.name}@${manifest.version}`;
const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;

function publishedIntegrity() {
  try {
    const output = execFileSync("npm", ["view", spec, "dist.integrity", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output ? JSON.parse(output) : undefined;
  } catch (error) {
    if (/E404|404 Not Found|is not in this registry/i.test(String(error.stderr ?? error.message))) {
      return undefined;
    }
    throw error;
  }
}

const existing = publishedIntegrity();
if (existing === integrity) {
  console.log(`${spec} is already published with identical content; skipping upload.`);
} else if (existing) {
  console.error(`${spec} is already published with different content (${existing}). Refusing to overwrite a released version.`);
  process.exit(1);
} else {
  execFileSync("npm", ["publish", tarball, "--provenance", "--access", "public", "--tag", distTag], {
    stdio: "inherit",
  });
}

for (let attempt = 1; attempt <= 30; attempt += 1) {
  const served = publishedIntegrity();
  if (served === integrity) {
    console.log(`${spec} is available from the registry with integrity ${integrity}.`);
    process.exit(0);
  }
  if (served && served !== integrity) {
    console.error(`${spec} is served with unexpected integrity ${served}.`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
console.error(`${spec} did not become available from the registry in time.`);
process.exit(1);
