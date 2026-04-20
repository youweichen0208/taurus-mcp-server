import { type Config } from "./schema.js";
export type { Config } from "./schema.js";
export declare function createConfigFromEnv(env?: NodeJS.ProcessEnv): Config;
export declare function getConfig(): Config;
export declare function resetConfigForTests(): void;
export declare function redactConfigForLog(config: Config): Record<string, unknown>;
