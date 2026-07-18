import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createConfigFromEnv,
  createHuaweiKmsSecretResolver,
} from "../dist/index.js";

function makeConfig() {
  return createConfigFromEnv({
    TAURUSDB_CLOUD_REGION: "cn-north-4",
    TAURUSDB_CLOUD_PROJECT_ID: "project-1",
    TAURUSDB_CLOUD_AUTH_TOKEN: "token-1",
  });
}

test("Huawei KMS resolver decrypts inline ciphertext", async () => {
  let capturedUrl;
  let capturedBody;
  let capturedHeaders;
  const resolver = createHuaweiKmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      capturedHeaders = new Headers(init.headers);
      return Response.json({
        plain_text_base64: Buffer.from(" db-password ", "utf8").toString("base64"),
      });
    },
  });

  const value = await resolver("hw-kms:kms-ciphertext");

  assert.equal(value, " db-password ");
  assert.equal(
    capturedUrl,
    "https://kms.cn-north-4.myhuaweicloud.com/v1.0/project-1/kms/decrypt-data",
  );
  assert.deepEqual(capturedBody, {
    cipher_text: "kms-ciphertext",
  });
  assert.equal(capturedHeaders.get("x-auth-token"), "token-1");
});

test("Huawei KMS resolver reads ciphertext from a file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurus-kms-"));
  const cipherPath = path.join(tempDir, "password.ciphertext");
  await writeFile(cipherPath, "kms-file-ciphertext\n", "utf8");

  const resolver = createHuaweiKmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.cipher_text, "kms-file-ciphertext");
      return Response.json({
        plain_text: "file-db-password",
      });
    },
  });

  const value = await resolver(`hw-kms-file:${cipherPath}`);
  assert.equal(value, "file-db-password");
});

test("Huawei KMS resolver rejects empty ciphertext before calling KMS", async () => {
  let called = false;
  const resolver = createHuaweiKmsSecretResolver({
    config: makeConfig(),
    fetchImpl: async () => {
      called = true;
      return Response.json({});
    },
  });

  await assert.rejects(() => resolver("hw-kms:"), /must not be empty/);
  assert.equal(called, false);
});
