import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HuaweiCloudCredentialProvider, HuaweiCloudCredentials } from "./auth.js";

const execFileAsync = promisify(execFile);

export type MacOsKeychainCredentialProviderOptions = {
  service: string;
  account?: string;
  platform?: NodeJS.Platform;
  readPassword?: (service: string, account: string) => Promise<string | undefined>;
};

export type LinuxSecretServiceCredentialProviderOptions = {
  service: string;
  account?: string;
  platform?: NodeJS.Platform;
  readPassword?: (
    service: string,
    account: string,
    key: string,
  ) => Promise<string | undefined>;
};

export type WindowsCredentialManagerProviderOptions = {
  service: string;
  account?: string;
  platform?: NodeJS.Platform;
  readPassword?: (
    service: string,
    account: string,
    key: string,
  ) => Promise<string | undefined>;
};

export type SystemCredentialProviderOptions = {
  service: string;
  account?: string;
  platform?: NodeJS.Platform;
};

async function readMacOsKeychainPassword(
  service: string,
  account: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    const value = stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? value : undefined;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "44") {
      return undefined;
    }
    throw new Error(`Failed to read macOS Keychain item "${service}".`, {
      cause: error,
    });
  }
}

async function readLinuxSecretServicePassword(
  service: string,
  account: string,
  key: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service",
      service,
      "account",
      account,
      "key",
      key,
    ]);
    const value = stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? value : undefined;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "1") {
      return undefined;
    }
    if (code === "ENOENT") {
      throw new Error(
        "Linux Secret Service requires the secret-tool command. Install libsecret-tools or the equivalent package.",
        { cause: error },
      );
    }
    throw new Error(`Failed to read Linux Secret Service item "${service}".`, {
      cause: error,
    });
  }
}

const WINDOWS_CREDENTIAL_READ_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaurusCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr buffer);
}
'@
$pointer = [IntPtr]::Zero
if (-not [TaurusCredentialManager]::CredRead($env:TAURUSDB_CREDENTIAL_TARGET, 1, 0, [ref]$pointer)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 0 }
  throw "CredReadW failed."
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][TaurusCredentialManager+Credential])
  if ($credential.CredentialBlobSize -gt 0) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
  }
} finally {
  [TaurusCredentialManager]::CredFree($pointer)
}
`;

async function readWindowsCredentialManagerPassword(
  service: string,
  account: string,
  key: string,
): Promise<string | undefined> {
  const target = `${service}/${account}/${key}`;
  const encodedScript = Buffer.from(WINDOWS_CREDENTIAL_READ_SCRIPT, "utf16le").toString(
    "base64",
  );
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript],
      {
        env: { ...process.env, TAURUSDB_CREDENTIAL_TARGET: target },
      },
    );
    const value = stdout.replace(/\r?\n$/, "");
    return value.length > 0 ? value : undefined;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "ENOENT") {
      throw new Error("Windows Credential Manager requires Windows PowerShell.", {
        cause: error,
      });
    }
    throw new Error(`Failed to read Windows Credential Manager item "${target}".`, {
      cause: error,
    });
  }
}

function createCachedCredentialProvider(
  readValues: () => Promise<HuaweiCloudCredentials>,
): HuaweiCloudCredentialProvider {
  let cached: Promise<HuaweiCloudCredentials> | undefined;
  return async () => {
    cached ??= readValues();
    return cached;
  };
}

export function createMacOsKeychainCredentialProvider(
  options: MacOsKeychainCredentialProviderOptions,
): HuaweiCloudCredentialProvider {
  const platform = options.platform ?? process.platform;
  const account = options.account ?? "default";
  const readPassword = options.readPassword ?? readMacOsKeychainPassword;
  return createCachedCredentialProvider(async (): Promise<HuaweiCloudCredentials> => {
    if (platform !== "darwin") {
      throw new Error(
        "Huawei Cloud system Keychain credentials currently require macOS.",
      );
    }

    const [accessKeyId, secretAccessKey, securityToken] = await Promise.all([
      readPassword(`${options.service}/access-key-id`, account),
      readPassword(`${options.service}/secret-access-key`, account),
      readPassword(`${options.service}/security-token`, account),
    ]);
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `Huawei Cloud credentials were not found in macOS Keychain service "${options.service}" for account "${account}".`,
      );
    }
    return { accessKeyId, secretAccessKey, securityToken };
  });
}

export function createLinuxSecretServiceCredentialProvider(
  options: LinuxSecretServiceCredentialProviderOptions,
): HuaweiCloudCredentialProvider {
  const platform = options.platform ?? process.platform;
  const account = options.account ?? "default";
  const readPassword = options.readPassword ?? readLinuxSecretServicePassword;

  return createCachedCredentialProvider(async (): Promise<HuaweiCloudCredentials> => {
    if (platform !== "linux") {
      throw new Error("Huawei Cloud Linux Secret Service credentials require Linux.");
    }
    const [accessKeyId, secretAccessKey, securityToken] = await Promise.all([
      readPassword(options.service, account, "access-key-id"),
      readPassword(options.service, account, "secret-access-key"),
      readPassword(options.service, account, "security-token"),
    ]);
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `Huawei Cloud credentials were not found in Linux Secret Service "${options.service}" for account "${account}".`,
      );
    }
    return { accessKeyId, secretAccessKey, securityToken };
  });
}

export function createWindowsCredentialManagerProvider(
  options: WindowsCredentialManagerProviderOptions,
): HuaweiCloudCredentialProvider {
  const platform = options.platform ?? process.platform;
  const account = options.account ?? "default";
  const readPassword = options.readPassword ?? readWindowsCredentialManagerPassword;

  return createCachedCredentialProvider(async (): Promise<HuaweiCloudCredentials> => {
    if (platform !== "win32") {
      throw new Error("Huawei Cloud Windows Credential Manager credentials require Windows.");
    }
    const [accessKeyId, secretAccessKey, securityToken] = await Promise.all([
      readPassword(options.service, account, "access-key-id"),
      readPassword(options.service, account, "secret-access-key"),
      readPassword(options.service, account, "security-token"),
    ]);
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `Huawei Cloud credentials were not found in Windows Credential Manager service "${options.service}" for account "${account}".`,
      );
    }
    return { accessKeyId, secretAccessKey, securityToken };
  });
}

export function createSystemCredentialProvider(
  options: SystemCredentialProviderOptions,
): HuaweiCloudCredentialProvider {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return createMacOsKeychainCredentialProvider({ ...options, platform });
  }
  if (platform === "linux") {
    return createLinuxSecretServiceCredentialProvider({ ...options, platform });
  }
  if (platform === "win32") {
    return createWindowsCredentialManagerProvider({ ...options, platform });
  }
  return async () => {
    throw new Error(
      `Huawei Cloud system credential storage is not supported on platform "${platform}".`,
    );
  };
}
