import { ConfigSchema, type Config } from "./schema.js";
import { buildRawConfigFromEnv } from "./env.js";
export { redactConfigForLog } from "./redaction.js";

export type { Config } from "./schema.js";

let configSingleton: Config | undefined;

export function createConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const parsed = ConfigSchema.safeParse(buildRawConfigFromEnv(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

export function getConfig(): Config {
  if (!configSingleton) {
    configSingleton = createConfigFromEnv(process.env);
  }
  return configSingleton;
}

export function resetConfigForTests(): void {
  configSingleton = undefined;
}
