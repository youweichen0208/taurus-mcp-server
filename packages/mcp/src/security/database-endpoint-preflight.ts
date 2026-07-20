import { createConnection } from "node:net";

export type DatabaseEndpointFailure = "refused" | "unreachable";

export class DatabaseEndpointPreflightError extends Error {
  readonly kind: DatabaseEndpointFailure;
  readonly host: string;
  readonly port: number;

  constructor(kind: DatabaseEndpointFailure, host: string, port: number) {
    super(`Database endpoint preflight failed: ${kind}`);
    this.name = "DatabaseEndpointPreflightError";
    this.kind = kind;
    this.host = host;
    this.port = port;
  }
}

export function preflightDatabaseEndpoint(
  host: string,
  port: number,
  timeoutMs = 3_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: DatabaseEndpointPreflightError) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(
      new DatabaseEndpointPreflightError("unreachable", host, port),
    ));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(
      new DatabaseEndpointPreflightError(
        error.code === "ECONNREFUSED" ? "refused" : "unreachable",
        host,
        port,
      ),
    ));
  });
}
