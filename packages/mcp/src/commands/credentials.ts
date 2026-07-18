import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAuthenticateHuaweiCloudRequests,
  createConfigFromEnv,
  createHuaweiCsmsSecretResolver,
  createHuaweiKmsSecretResolver,
  createSqlProfileLoader,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
  type Config,
} from "taurusdb-core";

function readOption(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function configureUsage(): string {
  return `Usage: taurusdb-mcp credentials configure [options]

Options:
  --service <name>         Credential service prefix (default: taurusdb-mcp/huaweicloud)
  --account <name>         Credential account (default: default)
  --with-security-token    Also store a temporary security token`;
}

function checkUsage(): string {
  return `Usage: taurusdb-mcp credentials check

Checks the configured Huawei Cloud identity and cloud-backed database password
references without printing or connecting with any secret values.`;
}

function runCommand(command: string, args: string[], errorMessage: string): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    throw new Error(`${command} was not found.`);
  }
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function storeMacOsSecret(service: string, account: string, label: string): void {
  process.stderr.write(`Enter ${label} in the macOS Keychain prompt.\n`);
  runCommand(
    "security",
    ["add-generic-password", "-U", "-s", service, "-a", account, "-w"],
    `Failed to store ${label} in macOS Keychain.`,
  );
}

function storeLinuxSecret(
  service: string,
  account: string,
  key: string,
  label: string,
): void {
  process.stderr.write(`Enter ${label} when prompted by Linux Secret Service.\n`);
  runCommand(
    "secret-tool",
    [
      "store",
      `--label=TaurusDB MCP Huawei Cloud ${label}`,
      "service",
      service,
      "account",
      account,
      "key",
      key,
    ],
    `Failed to store ${label} in Linux Secret Service.`,
  );
}

function configureWindows(
  service: string,
  account: string,
  withSecurityToken: boolean,
): void {
  const scriptPath = fileURLToPath(
    new URL("../../scripts/windows-credential-configure.ps1", import.meta.url),
  );
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.normalize(scriptPath),
    "-Service",
    service,
    "-Account",
    account,
  ];
  if (withSecurityToken) {
    args.push("-WithSecurityToken");
  }
  runCommand(
    "powershell.exe",
    args,
    "Failed to store credentials in Windows Credential Manager.",
  );
}

export function runCredentialsConfigure(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${configureUsage()}\n`);
    return 0;
  }

  const service = readOption(args, "--service", "taurusdb-mcp/huaweicloud");
  const account = readOption(args, "--account", "default");
  const withSecurityToken = args.includes("--with-security-token");

  if (process.platform === "darwin") {
    storeMacOsSecret(`${service}/access-key-id`, account, "Huawei Cloud access key ID");
    storeMacOsSecret(`${service}/secret-access-key`, account, "Huawei Cloud secret access key");
    if (withSecurityToken) {
      storeMacOsSecret(`${service}/security-token`, account, "Huawei Cloud security token");
    }
  } else if (process.platform === "linux") {
    storeLinuxSecret(service, account, "access-key-id", "Huawei Cloud access key ID");
    storeLinuxSecret(service, account, "secret-access-key", "Huawei Cloud secret access key");
    if (withSecurityToken) {
      storeLinuxSecret(service, account, "security-token", "Huawei Cloud security token");
    }
  } else if (process.platform === "win32") {
    configureWindows(service, account, withSecurityToken);
  } else {
    throw new Error(`System credential storage is not supported on platform "${process.platform}".`);
  }

  process.stdout.write(
    `Stored Huawei Cloud credentials in service "${service}" for account "${account}".\n`,
  );
  return 0;
}

function printResult(ok: boolean, title: string, details?: string): void {
  process.stdout.write(`${ok ? "[ok]" : "[fail]"} ${title}${details ? `: ${details}` : ""}\n`);
}

async function check(title: string, action: () => Promise<string>): Promise<boolean> {
  try {
    printResult(true, title, await action());
    return true;
  } catch (error) {
    printResult(false, title, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function getCloudResolver(uri: string, config: Config) {
  const normalized = uri.startsWith("uri:") ? uri.slice("uri:".length) : uri;
  if (normalized.startsWith("hw-csms:")) {
    return { kind: "CSMS", resolve: () => createHuaweiCsmsSecretResolver({ config })(normalized) };
  }
  if (normalized.startsWith("hw-kms:") || normalized.startsWith("hw-kms-file:")) {
    return { kind: "KMS", resolve: () => createHuaweiKmsSecretResolver({ config })(normalized) };
  }
  return undefined;
}

export async function runCredentialsCheck(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${checkUsage()}\n`);
    return 0;
  }

  const config = createConfigFromEnv(process.env);
  const auth = getHuaweiCloudAuthFromConfig(config);
  let failed = false;

  failed ||= !(await check("Huawei Cloud identity source", async () => {
    if (auth.authToken) return "IAM token configured";
    if (auth.accessKeyId && auth.secretAccessKey) return "AK/SK configured in environment";
    if (auth.credentialProvider) {
      await auth.credentialProvider();
      return "system credential store readable";
    }
    if (!canAuthenticateHuaweiCloudRequests(auth)) {
      throw new Error("No IAM token, AK/SK, or system credential store is configured.");
    }
    return "configured";
  }));

  if (!failed) {
    failed ||= !(await check("Huawei Cloud project", async () => {
      const projectId = await resolveHuaweiCloudProjectId(auth);
      if (!projectId) {
        throw new Error("Project ID could not be resolved.");
      }
      return config.cloud.projectId ? "configured" : "resolved through IAM";
    }));
  }

  const profiles = await createSqlProfileLoader({ config }).load();
  const cloudRefs = [...profiles.values()]
    .map((profile) => profile.user?.password)
    .filter((ref) => ref?.type === "uri")
    .map((ref) => getCloudResolver(ref.uri, config))
    .filter((resolver) => resolver !== undefined);

  if (cloudRefs.length === 0) {
    printResult(true, "Cloud-backed database password references", "none configured; skipped");
  } else if (!failed) {
    for (const resolver of cloudRefs) {
      const readable = await check(`${resolver.kind} database password reference`, async () => {
        await resolver.resolve();
        return "readable";
      });
      failed ||= !readable;
    }
  }

  return failed ? 1 : 0;
}

export async function runCredentials(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "configure") {
    return runCredentialsConfigure(args.slice(1));
  }
  if (command === "check") {
    return runCredentialsCheck(args.slice(1));
  }
  process.stderr.write("Usage: taurusdb-mcp credentials <configure|check>\n");
  return 1;
}
