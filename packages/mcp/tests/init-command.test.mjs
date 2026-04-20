import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.resolve(__dirname, "../dist/index.js");

function runInit(homeDir, client) {
  return spawnSync(process.execPath, [entrypoint, "init", "--client", client], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      APPDATA: path.join(homeDir, "AppData", "Roaming"),
    },
  });
}

test("init writes cursor config by merging server entry", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-mcp-init-"));
  const configPath = path.join(homeDir, ".cursor", "mcp.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({ mcpServers: { existing: { command: "node", args: ["existing"] } } }, null, 2)}\n`,
    "utf8",
  );

  const result = runInit(homeDir, "cursor");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /wrote cursor config/);
  assert.match(result.stderr, /added MCP server 'huaweicloud-taurusdb'/);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.existing, { command: "node", args: ["existing"] });
  assert.deepEqual(config.mcpServers["huaweicloud-taurusdb"], {
    command: "npx",
    args: ["-y", "@huaweicloud/taurusdb-mcp"],
  });
});

test("init does not overwrite an existing cursor server entry", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "taurusdb-mcp-init-conflict-"));
  const configPath = path.join(homeDir, ".cursor", "mcp.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  const original = {
    mcpServers: {
      "huaweicloud-taurusdb": {
        command: "node",
        args: ["custom-server.js"],
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

  const result = runInit(homeDir, "cursor");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /already contains 'huaweicloud-taurusdb'/);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config, original);
});
