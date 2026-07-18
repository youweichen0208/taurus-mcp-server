#!/usr/bin/env node

import { mkdir, chmod, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import readline from "node:readline";
import {
  createConfigFromEnv,
  createHuaweiKmsSecretResolver,
  fetchHuaweiCloud,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
} from "taurusdb-core";

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseArgs(argv) {
  const args = {
    output: "~/.taurusdb-mcp/production-password.ciphertext",
    verify: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      args.output = argv[++index];
      if (!args.output) {
        throw new Error("--output requires a path.");
      }
    } else if (value === "--no-verify") {
      args.verify = false;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function usage() {
  return `Usage: npm run kms:encrypt -- [--output <path>] [--no-verify]

Required environment:
  TAURUSDB_CLOUD_REGION
  HUAWEICLOUD_KMS_KEY_ID
  TAURUSDB_CLOUD_PROJECT_ID, or credentials that can resolve it
  TAURUSDB_CLOUD_AUTH_TOKEN, or TAURUSDB_CLOUD_ACCESS_KEY_ID + TAURUSDB_CLOUD_SECRET_ACCESS_KEY

Optional environment:
  TAURUSDB_CLOUD_SECURITY_TOKEN
  TAURUSDB_CLOUD_KMS_ENDPOINT`;
}

function expandPath(input) {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

function requireValue(name) {
  const value = optional(name);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
    if (!value) {
      throw new Error("Database password read from stdin is empty.");
    }
    return value;
  }

  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) {
        process.stderr.write(chunk);
      }
      callback();
    },
  });
  const prompt = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const password = await new Promise((resolve) => {
    prompt.question("TaurusDB password: ", (answer) => resolve(answer));
    muted = true;
  });
  muted = false;
  prompt.close();
  process.stderr.write("\n");
  if (!password) {
    throw new Error("Database password must not be empty.");
  }
  return password;
}

function readError(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  return payload.error_msg ?? payload.message ?? payload.error_code ?? payload.code ?? "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const config = createConfigFromEnv(process.env);
  const keyId = requireValue("HUAWEICLOUD_KMS_KEY_ID");
  const endpoint = config.cloud.kmsEndpoint?.replace(/\/+$/g, "");
  if (!endpoint) {
    throw new Error(
      "Huawei KMS endpoint is not configured. Set TAURUSDB_CLOUD_REGION or TAURUSDB_CLOUD_KMS_ENDPOINT.",
    );
  }

  const auth = getHuaweiCloudAuthFromConfig(config);
  const projectId = await resolveHuaweiCloudProjectId(auth);
  if (!projectId) {
    throw new Error(
      "Unable to resolve Huawei Cloud project id. Set TAURUSDB_CLOUD_PROJECT_ID or configure credentials that can resolve it.",
    );
  }

  const password = await readPassword();
  const response = await fetchHuaweiCloud({
    url: `${endpoint}/v1.0/${projectId}/kms/encrypt-data`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key_id: keyId,
      plain_text: password,
    }),
    auth,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.cipher_text !== "string" || !payload.cipher_text) {
    throw new Error(
      `Huawei KMS encrypt-data failed with status ${response.status}${readError(payload) ? `: ${readError(payload)}` : ""}.`,
    );
  }

  if (args.verify) {
    const resolveKmsSecret = createHuaweiKmsSecretResolver({ config });
    const decrypted = await resolveKmsSecret(`hw-kms:${payload.cipher_text}`);
    if (decrypted !== password) {
      throw new Error("Huawei KMS decrypt-data verification did not reproduce the input password.");
    }
  }

  const outputPath = expandPath(args.output);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${payload.cipher_text}\n`, { mode: 0o600 });
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);

  console.log(`[ok] KMS ciphertext written to ${outputPath}`);
  console.log(`[ok] decrypt-data verification ${args.verify ? "passed" : "skipped"}`);
  console.log(`Use password reference: hw-kms-file:${args.output}`);
}

main().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
