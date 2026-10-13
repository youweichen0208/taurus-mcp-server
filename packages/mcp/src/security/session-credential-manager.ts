import type { SessionTarget } from "./session-target.js";

const MINUTE_MS = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;

type CredentialSession = {
  createdAtMs: number;
  lastActivityAtMs: number;
  onExpire: () => Promise<void>;
  binding?: SessionTarget;
  timer?: TimerHandle;
};

export type SessionCredentialManagerOptions = {
  idleTtlMs?: number;
  maxTtlMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
  onExpirationError?: (error: unknown, datasource: string) => void;
};

export class SessionCredentialManager {
  private readonly idleTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly now: () => number;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelTimer: (timer: TimerHandle) => void;
  private readonly onExpirationError: (error: unknown, datasource: string) => void;
  private readonly sessions = new Map<string, CredentialSession>();

  constructor(options: SessionCredentialManagerOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 30 * MINUTE_MS;
    this.maxTtlMs = options.maxTtlMs ?? 8 * 60 * MINUTE_MS;
    this.now = options.now ?? Date.now;
    this.scheduleTimer = options.schedule ?? setTimeout;
    this.cancelTimer = options.cancel ?? clearTimeout;
    this.onExpirationError = options.onExpirationError ?? (() => undefined);
  }

  activate(
    datasource: string,
    onExpire: () => Promise<void>,
    binding?: SessionTarget,
  ): void {
    this.clear(datasource);
    const now = this.now();
    const session: CredentialSession = {
      createdAtMs: now,
      lastActivityAtMs: now,
      onExpire,
      binding: binding ? { ...binding } : undefined,
    };
    this.sessions.set(datasource, session);
    this.schedule(datasource, session);
  }

  async ensureFresh(datasource: string): Promise<void> {
    const now = this.now();
    const session = this.sessions.get(datasource);
    if (session && now >= this.deadline(session)) {
      await this.expireIfDue(datasource, session);
    }
  }

  /**
   * Returns the target an unexpired in-memory login session is bound to.
   * Static profile credentials never create a session, so they never match.
   */
  getActiveBinding(datasource: string): SessionTarget | undefined {
    const session = this.sessions.get(datasource);
    if (!session?.binding || this.now() >= this.deadline(session)) {
      return undefined;
    }
    return { ...session.binding };
  }

  touch(datasource: string): void {
    const session = this.sessions.get(datasource);
    if (session) {
      session.lastActivityAtMs = this.now();
      this.schedule(datasource, session);
    }
  }

  clear(datasource: string): void {
    const session = this.sessions.get(datasource);
    if (session?.timer) {
      this.cancelTimer(session.timer);
    }
    this.sessions.delete(datasource);
  }

  clearAll(): void {
    for (const datasource of [...this.sessions.keys()]) {
      this.clear(datasource);
    }
  }

  async close(): Promise<void> {
    this.clearAll();
  }

  private deadline(session: CredentialSession): number {
    return Math.min(
      session.lastActivityAtMs + this.idleTtlMs,
      session.createdAtMs + this.maxTtlMs,
    );
  }

  private schedule(datasource: string, session: CredentialSession): void {
    if (session.timer) {
      this.cancelTimer(session.timer);
    }
    const delayMs = Math.max(0, this.deadline(session) - this.now());
    session.timer = this.scheduleTimer(() => {
      void this.expireIfDue(datasource, session).catch((error: unknown) => {
        this.onExpirationError(error, datasource);
      });
    }, delayMs);
    session.timer.unref?.();
  }

  private async expireIfDue(datasource: string, expected: CredentialSession): Promise<void> {
    const current = this.sessions.get(datasource);
    if (current !== expected) {
      return;
    }
    if (this.now() < this.deadline(current)) {
      this.schedule(datasource, current);
      return;
    }
    this.sessions.delete(datasource);
    await current.onExpire();
  }
}
