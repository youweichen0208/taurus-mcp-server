import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

type TaskContext = {
  task_id: string;
};

const taskContextStorage = new AsyncLocalStorage<TaskContext>();

const REDACT_PATHS = [
  "password",
  "*.password",
  "credentials.*",
  "secret",
  "token",
  "*.token",
];

function createDefaultDestination(): DestinationStream {
  return pino.destination({ fd: 2, sync: false });
}

function createLoggerOptions(): LoggerOptions {
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

export function createLogger(destination?: DestinationStream | NodeJS.WritableStream): Logger {
  return pino(createLoggerOptions(), destination ?? createDefaultDestination());
}

export const logger = createLogger();

export function withTaskContext<T>(task_id: string, fn: () => Promise<T>): Promise<T> {
  return taskContextStorage.run({ task_id }, fn);
}

export function getTaskContext(): TaskContext | undefined {
  return taskContextStorage.getStore();
}
