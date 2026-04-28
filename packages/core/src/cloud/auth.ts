import { createHash, createHmac } from "node:crypto";
import type { Config } from "../config/index.js";

export interface HuaweiCloudAuthOptions {
  region?: string;
  projectId?: string;
  authToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  securityToken?: string;
  domainSuffix?: string;
  iamEndpoint?: string;
  language?: "en-us" | "zh-cn";
}

export interface FetchHuaweiCloudOptions {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: string;
  auth: HuaweiCloudAuthOptions;
  fetchImpl?: typeof fetch;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCanonicalUri(pathname: string): string {
  const segments = pathname.split("/").map((segment) => encodeRfc3986(segment));
  const normalized = segments.join("/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function buildCanonicalQueryString(url: URL): string {
  const pairs = [...url.searchParams.entries()].sort((left, right) => {
    if (left[0] === right[0]) {
      return left[1].localeCompare(right[1]);
    }
    return left[0].localeCompare(right[0]);
  });
  return pairs
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function formatSdkDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function inferRegionFromUrl(url: URL): string | undefined {
  const labels = url.hostname.split(".");
  return labels.length >= 3 ? labels[1] : undefined;
}

function buildHeaderMap(
  headers: HeadersInit | undefined,
  url: URL,
  sdkDate: string,
  securityToken?: string,
): Map<string, string> {
  const merged = new Headers(headers);
  merged.set("host", url.host);
  merged.set("x-sdk-date", sdkDate);
  if (securityToken) {
    merged.set("x-security-token", securityToken);
  }

  const map = new Map<string, string>();
  for (const [key, value] of merged.entries()) {
    map.set(key.toLowerCase(), normalizeHeaderValue(value));
  }
  return new Map([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function buildAuthorization(
  method: string,
  url: URL,
  headers: Map<string, string>,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
): string {
  const canonicalHeaders = [...headers.entries()]
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const signedHeaders = [...headers.keys()].join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    buildCanonicalUri(url.pathname || "/"),
    buildCanonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");
  const stringToSign = `SDK-HMAC-SHA256\n${headers.get("x-sdk-date")}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256Hex(secretAccessKey, stringToSign);
  return `SDK-HMAC-SHA256 Access=${accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function requireAksk(auth: HuaweiCloudAuthOptions): {
  accessKeyId: string;
  secretAccessKey: string;
} {
  const accessKeyId = readString(auth.accessKeyId);
  const secretAccessKey = readString(auth.secretAccessKey);
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Huawei Cloud request authentication is not configured. Provide TAURUSDB_CLOUD_AUTH_TOKEN or TAURUSDB_CLOUD_ACCESS_KEY_ID and TAURUSDB_CLOUD_SECRET_ACCESS_KEY.",
    );
  }
  return { accessKeyId, secretAccessKey };
}

export function canAuthenticateHuaweiCloudRequests(
  auth: HuaweiCloudAuthOptions,
): boolean {
  return Boolean(
    readString(auth.authToken) ||
      (readString(auth.accessKeyId) && readString(auth.secretAccessKey)),
  );
}

export async function fetchHuaweiCloud(
  options: FetchHuaweiCloudOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const method = options.method ?? "GET";
  const url = new URL(options.url);
  const body = options.body ?? "";
  const authToken = readString(options.auth.authToken);
  const headers = new Headers(options.headers);

  if (authToken) {
    headers.set("x-auth-token", authToken);
    return fetchImpl(url, {
      method,
      headers,
      body: options.body,
    });
  }

  const { accessKeyId, secretAccessKey } = requireAksk(options.auth);
  const sdkDate = formatSdkDate(new Date());
  const headerMap = buildHeaderMap(
    headers,
    url,
    sdkDate,
    readString(options.auth.securityToken),
  );
  headerMap.set(
    "authorization",
    buildAuthorization(method, url, headerMap, body, accessKeyId, secretAccessKey),
  );

  return fetchImpl(url, {
    method,
    headers: Object.fromEntries(headerMap.entries()),
    body: options.body,
  });
}

function buildIamEndpoint(auth: HuaweiCloudAuthOptions): string | undefined {
  const explicit = readString(auth.iamEndpoint);
  if (explicit) {
    return explicit.replace(/\/+$/g, "");
  }
  const region = readString(auth.region);
  if (!region) {
    return undefined;
  }
  const domainSuffix = readString(auth.domainSuffix) ?? "myhuaweicloud.com";
  return `https://iam.${region}.${domainSuffix}`;
}

function parseProjectItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const projects = record.projects ?? record.project_info ?? record.items;
  if (!Array.isArray(projects)) {
    return [];
  }
  return projects.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

export async function resolveHuaweiCloudProjectId(
  auth: HuaweiCloudAuthOptions,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  const explicitProjectId = readString(auth.projectId);
  if (explicitProjectId) {
    return explicitProjectId;
  }

  const iamEndpoint = buildIamEndpoint(auth);
  const region = readString(auth.region);
  if (!iamEndpoint || !region) {
    return undefined;
  }

  const response = await fetchHuaweiCloud({
    url: `${iamEndpoint}/v3/auth/projects`,
    headers: {
      "content-type": "application/json",
    },
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
      `Huawei Cloud project lookup failed with status ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}.`,
    );
  }

  const projects = parseProjectItems(payload);
  const exactMatch = projects.find((project) => readString(project.name) === region);
  if (exactMatch) {
    return readString(exactMatch.id);
  }
  if (projects.length === 1) {
    return readString(projects[0].id);
  }

  throw new Error(
    `Unable to resolve project id for region ${region}. Set TAURUSDB_CLOUD_PROJECT_ID explicitly or restrict the account to a single visible project in that region.`,
  );
}

export function getHuaweiCloudAuthFromConfig(config: Config): HuaweiCloudAuthOptions {
  return {
    region: config.cloud?.region,
    projectId: config.cloud?.projectId,
    authToken: config.cloud?.authToken,
    accessKeyId: config.cloud?.accessKeyId,
    secretAccessKey: config.cloud?.secretAccessKey,
    securityToken: config.cloud?.securityToken,
    domainSuffix: config.cloud?.domainSuffix,
    iamEndpoint: config.cloud?.iamEndpoint,
    language: config.cloud?.language,
  };
}

export function hasHuaweiCloudCredentialAuth(config: Config): boolean {
  return canAuthenticateHuaweiCloudRequests(getHuaweiCloudAuthFromConfig(config));
}

export function inferHuaweiCloudRegionFromEndpoint(endpoint: string | undefined): string | undefined {
  const normalized = readString(endpoint);
  if (!normalized) {
    return undefined;
  }
  try {
    return inferRegionFromUrl(new URL(normalized));
  } catch {
    return undefined;
  }
}
