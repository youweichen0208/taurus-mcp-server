import os from "node:os";
import path from "node:path";
import { ConfigSchema } from "./schema.js";
let configSingleton;
function readString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function parseBoolean(value, name) {
    const normalized = readString(value)?.toLowerCase();
    if (normalized === undefined) {
        return undefined;
    }
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
        return false;
    }
    throw new Error(`Invalid boolean for ${name}: "${value}". Expected one of true/false/1/0/yes/no/on/off.`);
}
function parseInteger(value, name) {
    const normalized = readString(value);
    if (normalized === undefined) {
        return undefined;
    }
    if (!/^-?\d+$/.test(normalized)) {
        throw new Error(`Invalid integer for ${name}: "${value}".`);
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        throw new Error(`Invalid integer for ${name}: "${value}".`);
    }
    return parsed;
}
function expandTildePath(inputPath) {
    if (!inputPath) {
        return undefined;
    }
    if (inputPath === "~") {
        return os.homedir();
    }
    if (inputPath.startsWith("~/")) {
        return path.join(os.homedir(), inputPath.slice(2));
    }
    return inputPath;
}
function buildRawConfigFromEnv(env) {
    return {
        defaultDatasource: readString(env.TAURUSDB_DEFAULT_DATASOURCE),
        profilesPath: expandTildePath(readString(env.TAURUSDB_SQL_PROFILES)),
        enableMutations: parseBoolean(env.TAURUSDB_MCP_ENABLE_MUTATIONS, "TAURUSDB_MCP_ENABLE_MUTATIONS"),
        limits: {
            maxRows: parseInteger(env.TAURUSDB_MCP_MAX_ROWS, "TAURUSDB_MCP_MAX_ROWS"),
            maxColumns: parseInteger(env.TAURUSDB_MCP_MAX_COLUMNS, "TAURUSDB_MCP_MAX_COLUMNS"),
            maxStatementMs: parseInteger(env.TAURUSDB_MCP_MAX_STATEMENT_MS, "TAURUSDB_MCP_MAX_STATEMENT_MS"),
            maxFieldChars: parseInteger(env.TAURUSDB_MCP_MAX_FIELD_CHARS, "TAURUSDB_MCP_MAX_FIELD_CHARS"),
        },
        audit: {
            logPath: expandTildePath(readString(env.TAURUSDB_MCP_AUDIT_LOG_PATH)),
            includeRawSql: parseBoolean(env.TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL, "TAURUSDB_MCP_AUDIT_INCLUDE_RAW_SQL"),
        },
    };
}
export function createConfigFromEnv(env = process.env) {
    const parsed = ConfigSchema.safeParse(buildRawConfigFromEnv(env));
    if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
        throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
    }
    return parsed.data;
}
export function getConfig() {
    if (!configSingleton) {
        configSingleton = createConfigFromEnv(process.env);
    }
    return configSingleton;
}
export function resetConfigForTests() {
    configSingleton = undefined;
}
const SENSITIVE_KEY_PATTERN = /(password|secret|token|credential|apikey|api_key)/i;
function deepRedact(value) {
    if (Array.isArray(value)) {
        return value.map((item) => deepRedact(item));
    }
    if (value && typeof value === "object") {
        const output = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : deepRedact(nestedValue);
        }
        return output;
    }
    return value;
}
export function redactConfigForLog(config) {
    return deepRedact(config);
}
