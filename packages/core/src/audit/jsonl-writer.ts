import { constants } from "node:fs";
import { chmod, mkdir, open, type FileHandle } from "node:fs/promises";
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
}

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

export class JsonlAuditWriter implements AuditWriter {
  private readonly handle: FileHandle;
  private readonly syncWrites: boolean;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(handle: FileHandle, syncWrites: boolean) {
    this.handle = handle;
    this.syncWrites = syncWrites;
  }

  static async create(options: JsonlAuditWriterOptions): Promise<JsonlAuditWriter> {
    const logPath = path.resolve(expandHome(options.logPath));
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(
      logPath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow,
      0o600,
    );
    await chmod(logPath, 0o600);
    return new JsonlAuditWriter(handle, options.syncWrites ?? true);
  }

  write(event: AuditEvent): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Audit writer is closed."));
    }
    const line = `${JSON.stringify(event)}\n`;
    const next = this.pending.then(async () => {
      await this.handle.write(line, undefined, "utf8");
      if (this.syncWrites) {
        await this.handle.sync();
      }
    });
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

export function createJsonlAuditWriter(
  options: JsonlAuditWriterOptions,
): Promise<JsonlAuditWriter> {
  return JsonlAuditWriter.create(options);
}
