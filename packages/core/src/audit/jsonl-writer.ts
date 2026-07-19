import { constants } from "node:fs";
import {
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AuditDecision =
  | "allowed"
  | "blocked"
  | "approval_required"
  | "approval_denied"
  | "failed";

export interface AuditEvent {
  timestamp: string;
  task_id: string;
  tool: string;
  actor: string;
  datasource?: string;
  database?: string;
  host?: string;
  port?: number;
  project_id?: string;
  instance_id?: string;
  node_id?: string;
  sql_hash?: string;
  raw_sql?: string;
  decision: AuditDecision;
  outcome: "success" | "error";
  error_code?: string;
  duration_ms: number;
}

export interface AuditWriter {
  write(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

export interface JsonlAuditWriterOptions {
  logPath: string;
  syncWrites?: boolean;
  maxBytes?: number;
  maxFiles?: number;
}

type OpenedAuditFile = {
  handle: FileHandle;
  size: number;
};

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

export class JsonlAuditWriter implements AuditWriter {
  private handle: FileHandle;
  private readonly logPath: string;
  private readonly syncWrites: boolean;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentBytes: number;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    opened: OpenedAuditFile,
    logPath: string,
    syncWrites: boolean,
    maxBytes: number,
    maxFiles: number,
  ) {
    this.handle = opened.handle;
    this.currentBytes = opened.size;
    this.logPath = logPath;
    this.syncWrites = syncWrites;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
  }

  static async create(options: JsonlAuditWriterOptions): Promise<JsonlAuditWriter> {
    const logPath = path.resolve(expandHome(options.logPath));
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    const opened = await openAuditFile(logPath);
    const maxBytes = options.maxBytes ?? 104857600;
    const maxFiles = options.maxFiles ?? 10;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      await opened.handle.close();
      throw new Error("Audit maxBytes must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0 || maxFiles > 100) {
      await opened.handle.close();
      throw new Error("Audit maxFiles must be an integer between 1 and 100.");
    }
    return new JsonlAuditWriter(
      opened,
      logPath,
      options.syncWrites ?? true,
      maxBytes,
      maxFiles,
    );
  }

  private async rotate(): Promise<void> {
    if (this.syncWrites) {
      await this.handle.sync();
    }
    await this.handle.close();

    try {
      await rm(`${this.logPath}.${this.maxFiles}`, { force: true });
      for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
        const source = `${this.logPath}.${index}`;
        const destination = `${this.logPath}.${index + 1}`;
        try {
          await rm(destination, { force: true });
          await rename(source, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
      await rm(`${this.logPath}.1`, { force: true });
      await rename(this.logPath, `${this.logPath}.1`);
      const opened = await openAuditFile(this.logPath);
      this.handle = opened.handle;
      this.currentBytes = opened.size;
    } catch (error) {
      const reopened = await openAuditFile(this.logPath);
      this.handle = reopened.handle;
      this.currentBytes = reopened.size;
      throw error;
    }
  }

  private async writeLine(line: string): Promise<void> {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (this.currentBytes > 0 && this.currentBytes + lineBytes > this.maxBytes) {
      await this.rotate();
    }
    await this.handle.write(line, undefined, "utf8");
    this.currentBytes += lineBytes;
    if (this.syncWrites) {
      await this.handle.sync();
    }
  }

  write(event: AuditEvent): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Audit writer is closed."));
    }
    const line = `${JSON.stringify(event)}\n`;
    const next = this.pending.then(() => this.writeLine(line));
    this.pending = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pending;
    await this.handle.close();
  }
}

async function openAuditFile(logPath: string): Promise<OpenedAuditFile> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(
    logPath,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw new Error("Audit log target must be a regular file.");
    }
    await handle.chmod(0o600);
    return { handle, size: fileStat.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function createJsonlAuditWriter(
  options: JsonlAuditWriterOptions,
): Promise<JsonlAuditWriter> {
  return JsonlAuditWriter.create(options);
}
