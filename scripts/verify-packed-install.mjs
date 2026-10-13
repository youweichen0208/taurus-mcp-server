#!/usr/bin/env node
// Installs the published shape of taurusdb-core and taurusdb-mcp into a clean
// directory outside the repository, so workspace symlinks cannot hide packaging
// defects, then checks the CLI and a real MCP stdio handshake.
//
// Usage:
//   node scripts/verify-packed-install.mjs                     pack both workspaces, then verify
//   node scripts/verify-packed-install.mjs --tarballs <dir>    verify existing .tgz files in <dir>
//   node scripts/verify-packed-install.mjs --registry <ver>    install taurusdb-mcp@<ver> from npm
//   add --report <file> to write a JSON verification record
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`Check failed: ${name}${detail ? ` (${detail})` : ""}`);
  }
  console.log(`ok - ${name}`);
}

function findTarballs(dir) {
  const files = readdirSync(dir).filter((file) => file.endsWith(".tgz"));
  const pick = (prefix) => {
    const match = files.find((file) => file === `${prefix}-${expectedVersion}.tgz`);
    if (!match) throw new Error(`Missing ${prefix}-${expectedVersion}.tgz in ${dir}.`);
    return path.join(dir, match);
  };
  return { core: pick("taurusdb-core"), mcp: pick("taurusdb-mcp") };
}

const registryVersion = option("--registry");
const reportPath = option("--report");
const workDir = mkdtempSync(path.join(os.tmpdir(), "taurusdb-packed-install-"));
const installDir = path.join(workDir, "consumer");
let source;

try {
  if (registryVersion) {
    source = `registry:taurusdb-mcp@${registryVersion}`;
  } else {
    let tarballDir = option("--tarballs");
    if (!tarballDir) {
      tarballDir = path.join(workDir, "tarballs");
      mkdirSync(tarballDir);
      run(npm, ["pack", "--workspace", "taurusdb-core", "--workspace", "taurusdb-mcp", "--pack-destination", tarballDir], repoRoot);
    }
    source = `tarballs:${path.resolve(tarballDir)}`;
  }

  mkdirSync(installDir);
  writeFileSync(path.join(installDir, "package.json"), `${JSON.stringify({ name: "taurusdb-install-check", private: true }, null, 2)}\n`);
  const installArgs = ["install", "--no-audit", "--no-fund", "--ignore-scripts"];
  if (registryVersion) {
    installArgs.push(`taurusdb-mcp@${registryVersion}`);
  } else {
    const tarballs = findTarballs(source.slice("tarballs:".length));
    installArgs.push(tarballs.core, tarballs.mcp);
  }
  run(npm, installArgs, installDir);

  const expected = registryVersion ?? expectedVersion;
  const modules = path.join(installDir, "node_modules");
  const readInstalled = (name) => JSON.parse(readFileSync(path.join(modules, name, "package.json"), "utf8"));
  check("taurusdb-mcp installed at the expected version", readInstalled("taurusdb-mcp").version === expected, readInstalled("taurusdb-mcp").version);
  check("taurusdb-core resolved at the expected version", readInstalled("taurusdb-core").version === expected, readInstalled("taurusdb-core").version);
  check("taurusdb-core is a real install, not a workspace symlink", !lstatSync(path.join(modules, "taurusdb-core")).isSymbolicLink());
  check("Windows credential script is packaged", existsSync(path.join(modules, "taurusdb-mcp", "scripts", "windows-credential-configure.ps1")));
  check("CLI entry point is packaged", existsSync(path.join(modules, "taurusdb-mcp", "dist", "index.js")));

  const cli = path.join(modules, "taurusdb-mcp", "dist", "index.js");
  check("CLI reports the expected version", run(process.execPath, [cli, "--version"], installDir) === expected);
  check("CLI prints help", /Usage:/.test(run(process.execPath, [cli, "--help"], installDir)));

  const sdkRoot = path.join(modules, "@modelcontextprotocol", "sdk", "dist", "esm");
  const { Client } = await import(pathToFileURL(path.join(sdkRoot, "client", "index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkRoot, "client", "stdio.js")).href);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    cwd: installDir,
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: workDir,
      USERPROFILE: workDir,
      TAURUSDB_MCP_LOG_LEVEL: "error",
      TAURUSDB_MCP_AUDIT_LOG_PATH: path.join(workDir, "audit.jsonl"),
    },
  });
  const client = new Client({ name: "taurusdb-install-check", version: expected });
  try {
    await client.connect(transport);
    const server = client.getServerVersion();
    check("MCP initialize reports the expected server version", server?.version === expected, server?.version);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    check("MCP tools/list exposes readonly tools", ["execute_readonly_sql", "analyze_mutation_sql", "list_recycle_bin"].every((name) => tools.includes(name)), tools.join(","));
    check("MCP tools/list exposes no general mutation tool", !tools.includes("execute_sql"));
    await client.ping();
    check("MCP ping succeeds", true);
  } finally {
    await transport.close();
  }

  if (reportPath) {
    writeFileSync(reportPath, `${JSON.stringify({
      verified_at: new Date().toISOString(),
      source: registryVersion ? source : "local tarballs",
      version: expected,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      checks,
    }, null, 2)}\n`);
  }
  console.log(`Packed install verification passed for ${expected}.`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
