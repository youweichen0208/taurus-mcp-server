import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DefaultSecretResolver } from "../dist/auth/secret-resolver.js";

test("secret resolver returns plain values directly", async () => {
  const resolver = new DefaultSecretResolver({ env: {} });
  const value = await resolver.resolve({ type: "plain", value: "plain-secret" });
  assert.equal(value, "plain-secret");
});

test("secret resolver resolves env references", async () => {
  const resolver = new DefaultSecretResolver({
    env: { DB_PASSWORD: "env-secret" },
  });

  const value = await resolver.resolve({ type: "env", key: "DB_PASSWORD" });
  assert.equal(value, "env-secret");
});

test("secret resolver throws when env key is missing", async () => {
  const resolver = new DefaultSecretResolver({ env: {} });
  await assert.rejects(
    async () => resolver.resolve({ type: "env", key: "MISSING_PASSWORD" }),
    /Environment variable not found/,
  );
});

test("secret resolver resolves file references and trims trailing newline", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurus-secret-"));
  const secretPath = path.join(tempDir, "password.txt");
  await writeFile(secretPath, "file-secret\n", "utf-8");

  const resolver = new DefaultSecretResolver();
  const value = await resolver.resolve({ type: "file", path: secretPath });
  assert.equal(value, "file-secret");
});

test("secret resolver resolves relative file paths from cwd", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "taurus-secret-rel-"));
  const secretPath = path.join(tempDir, "password.txt");
  await writeFile(secretPath, "relative-secret", "utf-8");
  const relativePath = path.relative(process.cwd(), secretPath);

  const resolver = new DefaultSecretResolver();
  const value = await resolver.resolve({ type: "file", path: relativePath });
  assert.equal(value, "relative-secret");
});

test("secret resolver throws for unsupported uri schemes", async () => {
  const resolver = new DefaultSecretResolver();
  await assert.rejects(
    async () => resolver.resolve({ type: "uri", uri: "aws-sm://prod/mysql/password" }),
    /Unsupported credential URI scheme: aws-sm/,
  );
});

test("secret resolver delegates uri refs to registered handlers", async () => {
  const resolver = new DefaultSecretResolver({
    uriResolvers: {
      "aws-sm": async (uri) => `resolved:${uri}`,
      "hw-kms": async (_uri) => "kms-secret",
    },
  });

  const awsValue = await resolver.resolve({ type: "uri", uri: "aws-sm://prod/mysql/password" });
  assert.equal(awsValue, "resolved:aws-sm://prod/mysql/password");

  const prefixedValue = await resolver.resolve({ type: "uri", uri: "uri:hw-kms://cn-north-4/key1" });
  assert.equal(prefixedValue, "kms-secret");
});
