import type { UriSecretResolver } from "../auth/secret-resolver.js";
import type { Config } from "../config/index.js";
import {
  fetchHuaweiCloud,
  getHuaweiCloudAuthFromConfig,
  resolveHuaweiCloudProjectId,
} from "./auth.js";

export type HuaweiCsmsSecretResolverOptions = {
  config: Config;
  fetchImpl?: typeof fetch;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readSecretName(uri: string): string {
  if (!uri.startsWith("hw-csms:")) {
    throw new Error(`Unsupported Huawei CSMS credential reference: ${uri}`);
  }
  const secretName = decodeURIComponent(uri.slice("hw-csms:".length).trim());
  if (!secretName) {
    throw new Error("Huawei CSMS credential reference is missing a secret name.");
  }
  return secretName;
}

function parseSecretString(payload: unknown): string {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const version =
    record.version && typeof record.version === "object" && !Array.isArray(record.version)
      ? (record.version as Record<string, unknown>)
      : {};
  const secretString = readString(version.secret_string);
  if (!secretString) {
    throw new Error("Huawei CSMS response did not include version.secret_string.");
  }
  return secretString;
}

export function createHuaweiCsmsSecretResolver(
  options: HuaweiCsmsSecretResolverOptions,
): UriSecretResolver {
  const auth = getHuaweiCloudAuthFromConfig(options.config);
  const endpoint = options.config.cloud.csmsEndpoint?.replace(/\/+$/g, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (uri: string): Promise<string> => {
    if (!endpoint) {
      throw new Error(
        "Huawei CSMS endpoint is not configured. Set TAURUSDB_CLOUD_REGION or TAURUSDB_CLOUD_CSMS_ENDPOINT.",
      );
    }

    const [secretName, projectId] = await Promise.all([
      Promise.resolve(readSecretName(uri)),
      resolveHuaweiCloudProjectId(auth, fetchImpl),
    ]);
    if (!projectId) {
      throw new Error(
        "Huawei CSMS request could not resolve a project id. Set TAURUSDB_CLOUD_PROJECT_ID or configure region plus Huawei Cloud credentials.",
      );
    }

    const response = await fetchHuaweiCloud({
      url: `${endpoint}/v1/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest`,
      headers: { "content-type": "application/json" },
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
        `Huawei CSMS request failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`,
      );
    }

    return parseSecretString(payload);
  };
}
