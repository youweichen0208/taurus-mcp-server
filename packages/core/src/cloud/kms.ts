import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UriSecretResolver } from "../auth/secret-resolver.js";
import type { Config } from "../config/index.js";
import {
  fetchHuaweiCloud,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
} from "./auth.js";

export type HuaweiKmsSecretResolverOptions = {
  config: Config;
  fetchImpl?: typeof fetch;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveFilePath(rawPath: string): string {
  const decoded = decodeURIComponent(rawPath);
  if (decoded === "~") {
    return os.homedir();
  }
  if (decoded.startsWith("~/")) {
    return path.join(os.homedir(), decoded.slice(2));
  }
  return path.isAbsolute(decoded) ? decoded : path.resolve(process.cwd(), decoded);
}

function requireValue(value: string, context: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${context} must not be empty.`);
  }
  return normalized;
}

async function readCipherText(uri: string): Promise<string> {
  if (uri.startsWith("hw-kms-file:")) {
    const rawPath = uri.slice("hw-kms-file:".length).trim();
    if (!rawPath) {
      throw new Error("Huawei KMS file credential reference is missing a path.");
    }
    return requireValue(await readFile(resolveFilePath(rawPath), "utf8"), "Huawei KMS ciphertext");
  }

  if (uri.startsWith("hw-kms:")) {
    return requireValue(uri.slice("hw-kms:".length), "Huawei KMS ciphertext");
  }

  throw new Error(`Unsupported Huawei KMS credential reference: ${uri}`);
}

function parsePlainText(payload: unknown): string {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const plainTextBase64 =
    typeof record.plain_text_base64 === "string" ? record.plain_text_base64 : undefined;
  if (plainTextBase64 !== undefined && plainTextBase64.length > 0) {
    return Buffer.from(plainTextBase64, "base64").toString("utf8");
  }
  const plainText = typeof record.plain_text === "string" ? record.plain_text : undefined;
  if (plainText !== undefined && plainText.length > 0) {
    return plainText;
  }
  throw new Error(
    "Huawei KMS decrypt response did not include plain_text or plain_text_base64.",
  );
}

export function createHuaweiKmsSecretResolver(
  options: HuaweiKmsSecretResolverOptions,
): UriSecretResolver {
  const auth = getHuaweiCloudAuthFromConfig(options.config);
  const endpoint = options.config.cloud.kmsEndpoint?.replace(/\/+$/g, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (uri: string): Promise<string> => {
    if (!endpoint) {
      throw new Error(
        "Huawei KMS endpoint is not configured. Set TAURUSDB_CLOUD_REGION or TAURUSDB_CLOUD_KMS_ENDPOINT.",
      );
    }

    const [cipherText, projectId] = await Promise.all([
      readCipherText(uri),
      resolveHuaweiCloudProjectId(auth, fetchImpl),
    ]);
    if (!projectId) {
      throw new Error(
        "Huawei KMS decrypt could not resolve a project id. Set TAURUSDB_CLOUD_PROJECT_ID or configure region plus Huawei Cloud credentials.",
      );
    }

    const response = await fetchHuaweiCloud({
      url: `${endpoint}/v1.0/${projectId}/kms/decrypt-data`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cipher_text: cipherText }),
      auth,
      fetchImpl,
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const record =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      const code = readString(record.error_code) ?? readString(record.code);
      const message = readString(record.error_msg) ?? readString(record.message);
      throw new Error(
        `Huawei KMS decrypt failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`,
      );
    }

    return parsePlainText(payload);
  };
}
