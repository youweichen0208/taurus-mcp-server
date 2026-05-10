import type { Config } from "./schema.js";

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|credential|apikey|api_key|accesskey|access_key|secretaccesskey|secret_access_key)/i;

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : deepRedact(nestedValue);
    }
    return output;
  }

  return value;
}

export function redactConfigForLog(config: Config): Record<string, unknown> {
  return deepRedact(config) as Record<string, unknown>;
}
