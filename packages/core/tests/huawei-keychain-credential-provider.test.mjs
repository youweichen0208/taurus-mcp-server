import assert from "node:assert/strict";
import test from "node:test";

import {
  createLinuxSecretServiceCredentialProvider,
  createMacOsKeychainCredentialProvider,
  createSystemCredentialProvider,
  createWindowsCredentialManagerProvider,
} from "../dist/index.js";

test("macOS Keychain provider reads and caches Huawei Cloud credentials", async () => {
  const reads = [];
  const provider = createMacOsKeychainCredentialProvider({
    service: "taurusdb-mcp/huaweicloud",
    account: "production",
    platform: "darwin",
    readPassword: async (service, account) => {
      reads.push({ service, account });
      if (service.endsWith("/access-key-id")) return "ak-1";
      if (service.endsWith("/secret-access-key")) return "sk-1";
      return undefined;
    },
  });

  assert.deepEqual(await provider(), {
    accessKeyId: "ak-1",
    secretAccessKey: "sk-1",
    securityToken: undefined,
  });
  await provider();

  assert.equal(reads.length, 3);
  assert.ok(reads.every((item) => item.account === "production"));
});

test("macOS Keychain provider reports missing required credentials", async () => {
  const provider = createMacOsKeychainCredentialProvider({
    service: "taurusdb-mcp/huaweicloud",
    platform: "darwin",
    readPassword: async () => undefined,
  });

  await assert.rejects(provider(), /credentials were not found in macOS Keychain/);
});

test("macOS Keychain provider rejects unsupported platforms", async () => {
  const provider = createMacOsKeychainCredentialProvider({
    service: "taurusdb-mcp/huaweicloud",
    platform: "linux",
    readPassword: async () => undefined,
  });

  await assert.rejects(provider(), /currently require macOS/);
});

test("Linux Secret Service provider reads and caches Huawei Cloud credentials", async () => {
  const reads = [];
  const provider = createLinuxSecretServiceCredentialProvider({
    service: "taurusdb-mcp/huaweicloud",
    account: "production",
    platform: "linux",
    readPassword: async (service, account, key) => {
      reads.push({ service, account, key });
      if (key === "access-key-id") return "ak-linux";
      if (key === "secret-access-key") return "sk-linux";
      return undefined;
    },
  });

  assert.deepEqual(await provider(), {
    accessKeyId: "ak-linux",
    secretAccessKey: "sk-linux",
    securityToken: undefined,
  });
  await provider();

  assert.equal(reads.length, 3);
  assert.ok(reads.every((item) => item.service === "taurusdb-mcp/huaweicloud"));
});

test("system credential provider selects the current platform implementation", async () => {
  const provider = createSystemCredentialProvider({
    service: "taurusdb-mcp/huaweicloud",
    platform: "freebsd",
  });

  await assert.rejects(provider(), /not supported on platform "freebsd"/);
});

test("Windows Credential Manager provider reads and caches Huawei Cloud credentials", async () => {
  const reads = [];
  const provider = createWindowsCredentialManagerProvider({
    service: "taurusdb-mcp/huaweicloud",
    account: "production",
    platform: "win32",
    readPassword: async (service, account, key) => {
      reads.push({ service, account, key });
      if (key === "access-key-id") return "ak-windows";
      if (key === "secret-access-key") return "sk-windows";
      return undefined;
    },
  });

  assert.deepEqual(await provider(), {
    accessKeyId: "ak-windows",
    secretAccessKey: "sk-windows",
    securityToken: undefined,
  });
  await provider();

  assert.equal(reads.length, 3);
  assert.ok(reads.every((item) => item.account === "production"));
});

test("Windows Credential Manager provider reports missing required credentials", async () => {
  const provider = createWindowsCredentialManagerProvider({
    service: "taurusdb-mcp/huaweicloud",
    platform: "win32",
    readPassword: async () => undefined,
  });

  await assert.rejects(provider(), /not found in Windows Credential Manager/);
});
