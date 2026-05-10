import type { CredentialRef, DataSourceProfile, DatabaseEngine, TlsOptions, UserCredential } from "./types.js";

const CREDENTIAL_URI_PREFIXES = ["aws-sm:", "hw-kms:", "uri:"];
const SENSITIVE_KEY_PATTERN = /(password|secret|token|credential|apikey|api_key)/i;

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function defaultPortForEngine(engine: DatabaseEngine): number {
  return engine === "postgresql" ? 5432 : 3306;
}

export function parseEngine(value: unknown, context: string): DatabaseEngine {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === "mysql") {
    return "mysql";
  }
  if (normalized === "postgresql" || normalized === "postgres" || normalized === "pg") {
    return "postgresql";
  }
  throw new Error(`Invalid engine in ${context}. Expected mysql or postgresql.`);
}

export function parseCredentialRef(value: unknown, context: string): CredentialRef {
  if (typeof value === "string") {
    if (value.startsWith("env:")) {
      const key = value.slice("env:".length).trim();
      if (!key) {
        throw new Error(`Invalid env credential ref in ${context}: missing key.`);
      }
      return { type: "env", key };
    }
    if (value.startsWith("file:")) {
      const filePath = value.slice("file:".length).trim();
      if (!filePath) {
        throw new Error(`Invalid file credential ref in ${context}: missing path.`);
      }
      return { type: "file", path: filePath };
    }
    if (CREDENTIAL_URI_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      return { type: "uri", uri: value };
    }
    return { type: "plain", value };
  }

  if (!isObject(value)) {
    throw new Error(`Invalid credential ref in ${context}: expected string or object.`);
  }

  const type = asString(value.type);
  if (type === "plain") {
    const plain = asString(value.value);
    if (!plain) {
      throw new Error(`Invalid plain credential ref in ${context}: missing value.`);
    }
    return { type: "plain", value: plain };
  }
  if (type === "env") {
    const key = asString(value.key);
    if (!key) {
      throw new Error(`Invalid env credential ref in ${context}: missing key.`);
    }
    return { type: "env", key };
  }
  if (type === "file") {
    const filePath = asString(value.path);
    if (!filePath) {
      throw new Error(`Invalid file credential ref in ${context}: missing path.`);
    }
    return { type: "file", path: filePath };
  }
  if (type === "uri") {
    const uri = asString(value.uri);
    if (!uri) {
      throw new Error(`Invalid uri credential ref in ${context}: missing uri.`);
    }
    return { type: "uri", uri };
  }

  throw new Error(`Invalid credential ref type in ${context}.`);
}

export function parseUserCredential(value: unknown, context: string): UserCredential {
  if (!isObject(value)) {
    throw new Error(`Invalid user credential in ${context}: expected object.`);
  }

  const username = asString(value.username ?? value.user);
  if (!username) {
    throw new Error(`Invalid user credential in ${context}: missing username.`);
  }

  if (!Object.hasOwn(value, "password") && !Object.hasOwn(value, "pass")) {
    throw new Error(`Invalid user credential in ${context}: missing password.`);
  }
  const password = parseCredentialRef(value.password ?? value.pass, `${context}.password`);

  return { username, password };
}

export function parseTlsOptions(value: unknown, context: string): TlsOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return { enabled: value };
  }
  if (!isObject(value)) {
    throw new Error(`Invalid tls config in ${context}: expected boolean or object.`);
  }

  const parsed: TlsOptions = {};
  const enabled = asBoolean(value.enabled);
  if (enabled !== undefined) {
    parsed.enabled = enabled;
  }
  const rejectUnauthorized = asBoolean(value.rejectUnauthorized);
  if (rejectUnauthorized !== undefined) {
    parsed.rejectUnauthorized = rejectUnauthorized;
  }
  const servername = asString(value.servername);
  if (servername) {
    parsed.servername = servername;
  }

  if (Object.hasOwn(value, "ca")) {
    parsed.ca = parseCredentialRef(value.ca, `${context}.ca`);
  }
  if (Object.hasOwn(value, "cert")) {
    parsed.cert = parseCredentialRef(value.cert, `${context}.cert`);
  }
  if (Object.hasOwn(value, "key")) {
    parsed.key = parseCredentialRef(value.key, `${context}.key`);
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepRedact(entry));
  }
  if (isObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : deepRedact(nested);
    }
    return output;
  }
  return value;
}

export function redactDataSourceProfile(profile: DataSourceProfile): Record<string, unknown> {
  return deepRedact(profile) as Record<string, unknown>;
}

export function withRedactedToString(profile: Omit<DataSourceProfile, "toString">): DataSourceProfile {
  const instance = profile as DataSourceProfile;
  Object.defineProperty(instance, "toString", {
    enumerable: false,
    configurable: false,
    writable: false,
    value() {
      return JSON.stringify(redactDataSourceProfile(instance));
    },
  });
  return instance;
}

export function parseProfileRecord(name: string, value: unknown, context: string): DataSourceProfile {
  if (!isObject(value)) {
    throw new Error(`Invalid datasource profile ${name} in ${context}: expected object.`);
  }

  const engine = parseEngine(value.engine ?? "mysql", `${context}.${name}.engine`);
  const host = asString(value.host ?? value.hostname);

  const parsedPort = asInteger(value.port);
  const port = parsedPort ?? defaultPortForEngine(engine);
  if (port <= 0) {
    throw new Error(`Invalid datasource profile ${name} in ${context}: port must be positive.`);
  }

  const database = asString(value.database);
  const poolSize = asInteger(value.poolSize);
  if (poolSize !== undefined && poolSize <= 0) {
    throw new Error(`Invalid datasource profile ${name} in ${context}: poolSize must be positive.`);
  }

  const readonlyRaw = value.readonlyUser ?? value.readonly ?? value.readOnlyUser;
  if (readonlyRaw === undefined) {
    throw new Error(`Invalid datasource profile ${name} in ${context}: missing readonlyUser.`);
  }
  const readonlyUser = parseUserCredential(readonlyRaw, `${context}.${name}.readonlyUser`);

  const mutationRaw = value.mutationUser ?? value.writeUser ?? value.rwUser;
  const mutationUser =
    mutationRaw !== undefined ? parseUserCredential(mutationRaw, `${context}.${name}.mutationUser`) : undefined;

  const tls = parseTlsOptions(value.tls, `${context}.${name}.tls`);

  return withRedactedToString({
    name,
    engine,
    host,
    port,
    database,
    readonlyUser,
    mutationUser,
    tls,
    poolSize,
  });
}
