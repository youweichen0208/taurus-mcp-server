import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const CREDENTIAL_URI_PREFIXES = ["aws-sm:", "hw-kms:", "uri:"];
const SENSITIVE_KEY_PATTERN = /(password|secret|token|credential|apikey|api_key)/i;
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function asInteger(value) {
    if (typeof value === "number" && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number.parseInt(value, 10);
    }
    return undefined;
}
function asBoolean(value) {
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
function defaultPortForEngine(engine) {
    return engine === "postgresql" ? 5432 : 3306;
}
function parseEngine(value, context) {
    const normalized = asString(value)?.toLowerCase();
    if (normalized === "mysql") {
        return "mysql";
    }
    if (normalized === "postgresql" || normalized === "postgres" || normalized === "pg") {
        return "postgresql";
    }
    throw new Error(`Invalid engine in ${context}. Expected mysql or postgresql.`);
}
function parseCredentialRef(value, context) {
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
function parseUserCredential(value, context) {
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
function parseTlsOptions(value, context) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === "boolean") {
        return { enabled: value };
    }
    if (!isObject(value)) {
        throw new Error(`Invalid tls config in ${context}: expected boolean or object.`);
    }
    const parsed = {};
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
function deepRedact(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => deepRedact(entry));
    }
    if (isObject(value)) {
        const output = {};
        for (const [key, nested] of Object.entries(value)) {
            output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : deepRedact(nested);
        }
        return output;
    }
    return value;
}
export function redactDataSourceProfile(profile) {
    return deepRedact(profile);
}
function withRedactedToString(profile) {
    const instance = profile;
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
function parseProfileRecord(name, value, context) {
    if (!isObject(value)) {
        throw new Error(`Invalid datasource profile ${name} in ${context}: expected object.`);
    }
    const engine = parseEngine(value.engine ?? "mysql", `${context}.${name}.engine`);
    const host = asString(value.host ?? value.hostname);
    if (!host) {
        throw new Error(`Invalid datasource profile ${name} in ${context}: missing host.`);
    }
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
    const mutationUser = mutationRaw !== undefined ? parseUserCredential(mutationRaw, `${context}.${name}.mutationUser`) : undefined;
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
function parseProfilesFile(raw, filePath) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Invalid JSON in profiles file: ${filePath}`, { cause: error });
    }
    if (!isObject(parsed)) {
        throw new Error(`Invalid profiles file root in ${filePath}: expected object.`);
    }
    const root = parsed;
    const defaultDatasource = asString(root.defaultDatasource ?? root.default);
    const profileNode = root.dataSources ?? root.datasources ?? root.profiles;
    const profiles = new Map();
    if (profileNode === undefined) {
        return { profiles, defaultDatasource };
    }
    if (Array.isArray(profileNode)) {
        for (const item of profileNode) {
            if (!isObject(item)) {
                throw new Error(`Invalid profile item in ${filePath}: expected object.`);
            }
            const name = asString(item.name);
            if (!name) {
                throw new Error(`Invalid profile item in ${filePath}: missing name.`);
            }
            profiles.set(name, parseProfileRecord(name, item, filePath));
        }
        return { profiles, defaultDatasource };
    }
    if (!isObject(profileNode)) {
        throw new Error(`Invalid profiles node in ${filePath}: expected object or array.`);
    }
    for (const [name, profileValue] of Object.entries(profileNode)) {
        profiles.set(name, parseProfileRecord(name, profileValue, filePath));
    }
    return { profiles, defaultDatasource };
}
function parseEngineFromDsnProtocol(protocol) {
    const normalized = protocol.replace(/:$/, "").toLowerCase();
    if (normalized === "mysql" || normalized === "mysql2") {
        return "mysql";
    }
    if (normalized === "postgres" || normalized === "postgresql") {
        return "postgresql";
    }
    throw new Error(`Unsupported DSN protocol: ${protocol}`);
}
function parseEnvProfile(env) {
    const dsn = asString(env.TAURUSDB_SQL_DSN);
    const explicitHost = asString(env.TAURUSDB_SQL_HOST);
    const profileName = asString(env.TAURUSDB_SQL_DATASOURCE) ?? "env_default";
    if (!dsn && !explicitHost) {
        return undefined;
    }
    let engine;
    let host;
    let port;
    let database;
    let readonlyUsername;
    let readonlyPasswordRef;
    if (dsn) {
        const url = new URL(dsn);
        engine = parseEngineFromDsnProtocol(url.protocol);
        host = url.hostname;
        port = url.port ? Number.parseInt(url.port, 10) : defaultPortForEngine(engine);
        database = asString(url.pathname.replace(/^\//, ""));
        readonlyUsername = asString(decodeURIComponent(url.username));
        const dsnPassword = asString(decodeURIComponent(url.password));
        if (dsnPassword) {
            readonlyPasswordRef = parseCredentialRef(dsnPassword, "TAURUSDB_SQL_DSN.password");
        }
    }
    else {
        engine = parseEngine(asString(env.TAURUSDB_SQL_ENGINE) ?? "mysql", "TAURUSDB_SQL_ENGINE");
        host = explicitHost;
        const explicitPort = asInteger(env.TAURUSDB_SQL_PORT);
        port = explicitPort ?? defaultPortForEngine(engine);
        database = asString(env.TAURUSDB_SQL_DATABASE);
    }
    if (!host) {
        throw new Error("Failed to resolve SQL host from environment.");
    }
    if (!port || !Number.isFinite(port) || port <= 0) {
        throw new Error("Failed to resolve SQL port from environment.");
    }
    readonlyUsername = readonlyUsername ?? asString(env.TAURUSDB_SQL_USER);
    if (!readonlyUsername) {
        throw new Error("Missing readonly username in environment. Set TAURUSDB_SQL_USER or include it in DSN.");
    }
    readonlyPasswordRef =
        readonlyPasswordRef ??
            (Object.hasOwn(env, "TAURUSDB_SQL_PASSWORD")
                ? parseCredentialRef(env.TAURUSDB_SQL_PASSWORD, "TAURUSDB_SQL_PASSWORD")
                : undefined);
    if (!readonlyPasswordRef) {
        throw new Error("Missing readonly password in environment. Set TAURUSDB_SQL_PASSWORD or include it in DSN.");
    }
    const mutationUserName = asString(env.TAURUSDB_SQL_MUTATION_USER);
    const mutationPasswordRaw = asString(env.TAURUSDB_SQL_MUTATION_PASSWORD);
    let mutationUser;
    if (mutationUserName || mutationPasswordRaw) {
        if (!mutationUserName || !mutationPasswordRaw) {
            throw new Error("Invalid mutation credentials in environment: TAURUSDB_SQL_MUTATION_USER and TAURUSDB_SQL_MUTATION_PASSWORD must be set together.");
        }
        mutationUser = {
            username: mutationUserName,
            password: parseCredentialRef(mutationPasswordRaw, "TAURUSDB_SQL_MUTATION_PASSWORD"),
        };
    }
    const poolSize = asInteger(env.TAURUSDB_SQL_POOL_SIZE);
    if (poolSize !== undefined && poolSize <= 0) {
        throw new Error("Invalid TAURUSDB_SQL_POOL_SIZE: must be positive.");
    }
    return withRedactedToString({
        name: profileName,
        engine,
        host,
        port,
        database,
        readonlyUser: {
            username: readonlyUsername,
            password: readonlyPasswordRef,
        },
        mutationUser,
        poolSize,
    });
}
function resolveDefaultProfilePath(config) {
    if (config.profilesPath) {
        return config.profilesPath;
    }
    return path.join(os.homedir(), ".config", "taurusdb-mcp", "profiles.json");
}
async function exists(filePath) {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export class SqlProfileLoader {
    config;
    env;
    cache;
    pending;
    constructor(options) {
        this.config = options.config;
        this.env = options.env ?? process.env;
    }
    async load() {
        const loaded = await this.ensureLoaded();
        return new Map(loaded.profiles);
    }
    async getDefault() {
        const loaded = await this.ensureLoaded();
        return loaded.defaultDatasource;
    }
    async get(name) {
        const loaded = await this.ensureLoaded();
        return loaded.profiles.get(name);
    }
    async ensureLoaded() {
        if (this.cache) {
            return this.cache;
        }
        if (!this.pending) {
            this.pending = this.loadInternal();
        }
        const loaded = await this.pending;
        this.cache = loaded;
        this.pending = undefined;
        return loaded;
    }
    async loadInternal() {
        const mergedProfiles = new Map();
        const envProfile = parseEnvProfile(this.env);
        if (envProfile) {
            mergedProfiles.set(envProfile.name, envProfile);
        }
        const profilePath = resolveDefaultProfilePath(this.config);
        let fileDefaultDatasource;
        if (await exists(profilePath)) {
            const content = await readFile(profilePath, "utf-8");
            const parsed = parseProfilesFile(content, profilePath);
            fileDefaultDatasource = parsed.defaultDatasource;
            for (const [name, profile] of parsed.profiles.entries()) {
                mergedProfiles.set(name, profile);
            }
        }
        const defaultDatasource = this.config.defaultDatasource ??
            fileDefaultDatasource ??
            (mergedProfiles.size === 1 ? mergedProfiles.keys().next().value : undefined);
        return {
            profiles: mergedProfiles,
            defaultDatasource,
        };
    }
}
export function createSqlProfileLoader(options) {
    return new SqlProfileLoader(options);
}
