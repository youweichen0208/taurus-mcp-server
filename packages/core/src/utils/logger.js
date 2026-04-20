import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";
const taskContextStorage = new AsyncLocalStorage();
const REDACT_PATHS = [
    "password",
    "*.password",
    "credentials.*",
    "secret",
    "token",
    "*.token",
];
function createDefaultDestination() {
    return pino.destination({ fd: 2, sync: false });
}
function createLoggerOptions() {
    return {
        level: process.env.TAURUSDB_MCP_LOG_LEVEL ?? "info",
        base: undefined,
        redact: {
            paths: REDACT_PATHS,
            censor: "[REDACTED]",
        },
        mixin: () => {
            const taskId = taskContextStorage.getStore()?.task_id;
            return taskId ? { task_id: taskId } : {};
        },
        timestamp: pino.stdTimeFunctions.isoTime,
    };
}
export function createLogger(destination) {
    return pino(createLoggerOptions(), destination ?? createDefaultDestination());
}
export const logger = createLogger();
export function withTaskContext(task_id, fn) {
    return taskContextStorage.run({ task_id }, fn);
}
export function getTaskContext() {
    return taskContextStorage.getStore();
}
