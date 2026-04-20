import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type ClientName = "claude" | "cursor" | "vscode";

interface McpServerEntry {
  command: string;
  args: string[];
}

type JsonObject = Record<string, unknown>;

interface ClientAdapter {
  name: ClientName;
  getConfigPath(): Promise<string>;
  readConfig(configPath: string): Promise<JsonObject>;
  mergeServerEntry(config: JsonObject, serverName: string, entry: McpServerEntry): MergeResult;
  writeConfig(configPath: string, config: JsonObject): Promise<void>;
}

interface MergeResult {
  config: JsonObject;
  changed: boolean;
  conflict: boolean;
}

const SERVER_NAME = "huaweicloud-taurusdb";

function printInitUsage(): void {
  console.error("Usage: taurusdb-mcp init --client <claude|cursor|vscode>");
}

function parseClientArg(args: string[]): ClientName | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--client" || arg === "-c") {
      return toClientName(args[index + 1]);
    }
    if (arg.startsWith("--client=")) {
      return toClientName(arg.slice("--client=".length));
    }
  }

  return undefined;
}

function toClientName(value: string | undefined): ClientName | undefined {
  if (value === "claude" || value === "cursor" || value === "vscode") {
    return value;
  }
  return undefined;
}

function getAppDataDir(): string {
  const appData = process.env.APPDATA;
  if (appData && appData.trim().length > 0) {
    return appData;
  }

  return path.join(os.homedir(), "AppData", "Roaming");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pickExistingOrDefault(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
  if (!(await fileExists(filePath))) {
    return {};
  }

  const raw = await readFile(filePath, "utf-8");
  if (raw.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in config file: ${filePath}`, { cause: error });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file root must be a JSON object: ${filePath}`);
  }

  return parsed as JsonObject;
}

async function writeJsonObject(filePath: string, config: JsonObject): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function mergeWithKey(
  config: JsonObject,
  rootKey: "mcpServers" | "servers",
  serverName: string,
  entry: McpServerEntry,
): MergeResult {
  const current = config[rootKey];
  const nextConfig: JsonObject = { ...config };

  let servers: JsonObject;
  if (current === undefined) {
    servers = {};
  } else if (current !== null && typeof current === "object" && !Array.isArray(current)) {
    servers = { ...(current as JsonObject) };
  } else {
    throw new Error(`Config field \`${rootKey}\` must be an object.`);
  }

  if (Object.hasOwn(servers, serverName)) {
    return {
      config,
      changed: false,
      conflict: true,
    };
  }

  servers[serverName] = entry;
  nextConfig[rootKey] = servers;
  return {
    config: nextConfig,
    changed: true,
    conflict: false,
  };
}

const SHARED_ENTRY: McpServerEntry = {
  command: "npx",
  args: ["-y", "@huaweicloud/taurusdb-mcp"],
};

function createClaudeAdapter(): ClientAdapter {
  return {
    name: "claude",
    async getConfigPath() {
      const home = os.homedir();
      if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      if (process.platform === "win32") {
        return pickExistingOrDefault([
          path.join(getAppDataDir(), "Claude", "claude_desktop_config.json"),
          path.join(getAppDataDir(), "Claude", "config.json"),
        ]);
      }
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
    },
    readConfig: readJsonObject,
    mergeServerEntry(config, serverName, entry) {
      return mergeWithKey(config, "mcpServers", serverName, entry);
    },
    writeConfig: writeJsonObject,
  };
}

function createCursorAdapter(): ClientAdapter {
  return {
    name: "cursor",
    async getConfigPath() {
      return path.join(os.homedir(), ".cursor", "mcp.json");
    },
    readConfig: readJsonObject,
    mergeServerEntry(config, serverName, entry) {
      return mergeWithKey(config, "mcpServers", serverName, entry);
    },
    writeConfig: writeJsonObject,
  };
}

function createVsCodeAdapter(): ClientAdapter {
  return {
    name: "vscode",
    async getConfigPath() {
      const home = os.homedir();
      if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
      }
      if (process.platform === "win32") {
        return path.join(getAppDataDir(), "Code", "User", "mcp.json");
      }
      return path.join(home, ".config", "Code", "User", "mcp.json");
    },
    readConfig: readJsonObject,
    mergeServerEntry(config, serverName, entry) {
      return mergeWithKey(config, "servers", serverName, entry);
    },
    writeConfig: writeJsonObject,
  };
}

function getClientAdapter(client: ClientName): ClientAdapter {
  switch (client) {
    case "claude":
      return createClaudeAdapter();
    case "cursor":
      return createCursorAdapter();
    case "vscode":
      return createVsCodeAdapter();
    default: {
      const exhaustive: never = client;
      throw new Error(`Unsupported client: ${String(exhaustive)}`);
    }
  }
}

export async function runInit(args: string[]): Promise<number> {
  const client = parseClientArg(args);
  if (!client) {
    printInitUsage();
    return 1;
  }

  const adapter = getClientAdapter(client);
  const configPath = await adapter.getConfigPath();
  const config = await adapter.readConfig(configPath);
  const merged = adapter.mergeServerEntry(config, SERVER_NAME, SHARED_ENTRY);

  if (merged.conflict) {
    console.error(`[init] ${adapter.name} config already contains '${SERVER_NAME}', skipped update.`);
    console.error(`[init] config: ${configPath}`);
    return 0;
  }

  await adapter.writeConfig(configPath, merged.config);

  console.error(`[init] wrote ${adapter.name} config: ${configPath}`);
  console.error(`[init] added MCP server '${SERVER_NAME}'. Restart ${adapter.name} to apply.`);
  return 0;
}
