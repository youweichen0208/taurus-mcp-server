import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

type BrowserOperatorSession = {
  datasource: string;
  expiresAtMs: number;
};

export class BrowserOperatorSessionStore {
  private readonly now: () => number;
  private readonly cookieName: string;
  private readonly sessions = new Map<string, BrowserOperatorSession>();

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.cookieName = `taurusdb_mcp_operator_${randomBytes(8).toString("hex")}`;
  }

  issue(datasource: string, ttlMs = DEFAULT_TTL_MS): string {
    this.expire();
    const token = randomBytes(32).toString("base64url");
    const boundedTtlMs = Math.max(1, Math.min(ttlMs, DEFAULT_TTL_MS));
    this.sessions.set(token, {
      datasource,
      expiresAtMs: this.now() + boundedTtlMs,
    });
    return `${this.cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(boundedTtlMs / 1000)}`;
  }

  authorizes(cookieHeader: string | undefined, datasource: string): boolean {
    this.expire();
    const token = this.readCookie(cookieHeader);
    const session = token ? this.sessions.get(token) : undefined;
    return session?.datasource === datasource;
  }

  clear(): void {
    this.sessions.clear();
  }

  revokeDatasource(datasource: string): void {
    for (const [token, session] of this.sessions) {
      if (session.datasource === datasource) this.sessions.delete(token);
    }
  }

  private readCookie(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      const name = part.slice(0, separator).trim();
      if (name === this.cookieName) {
        return part.slice(separator + 1).trim() || undefined;
      }
    }
    return undefined;
  }

  private expire(): void {
    const now = this.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= now) this.sessions.delete(token);
    }
  }
}
