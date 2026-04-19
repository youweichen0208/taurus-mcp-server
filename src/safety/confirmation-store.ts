import { randomBytes } from "node:crypto";
import type { SessionContext } from "../context/session-context.js";
import { normalizeSql, sqlHash } from "../utils/hash.js";
import type { RiskLevel, ValidationResult } from "./sql-validator.js";

const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const TOKEN_PREFIX = "ctok_";

type StoredConfirmation = {
  token: string;
  sqlHash: string;
  normalizedSql: string;
  datasource: string;
  database?: string;
  riskLevel: RiskLevel;
  issuedAt: number;
  expiresAt: number;
  usedAt?: number;
};

export type IssueInput = {
  sqlHash: string;
  normalizedSql: string;
  context: SessionContext;
  riskLevel: RiskLevel;
  ttlSeconds?: number;
};

export type ConfirmationToken = {
  token: string;
  issuedAt: number;
  expiresAt: number;
};

export type ConfirmationValidationResult = ValidationResult & {
  valid: boolean;
  reason?: string;
};

export interface ConfirmationStore {
  issue(input: IssueInput): Promise<ConfirmationToken>;
  validate(
    token: string,
    currentSql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult>;
  revoke(token: string): Promise<void>;
}

export type ConfirmationStoreOptions = {
  ttlSeconds?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
  randomBytesFn?: (size: number) => Buffer;
};

function allowResult(): ConfirmationValidationResult {
  return {
    valid: true,
    action: "allow",
    riskLevel: "low",
    reasonCodes: [],
    riskHints: [],
  };
}

function blockResult(code: string, message: string): ConfirmationValidationResult {
  return {
    valid: false,
    action: "block",
    riskLevel: "blocked",
    reason: message,
    reasonCodes: [code],
    riskHints: [message],
  };
}

function normalizeDatabase(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTtlSeconds(ttlSeconds: number | undefined, fallback: number): number {
  const resolved = ttlSeconds ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`Invalid ttlSeconds: ${ttlSeconds}. It must be a positive integer.`);
  }
  return resolved;
}

export class InMemoryConfirmationStore implements ConfirmationStore {
  private readonly entries = new Map<string, StoredConfirmation>();
  private readonly now: () => number;
  private readonly ttlSeconds: number;
  private readonly randomBytesFn: (size: number) => Buffer;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: ConfirmationStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlSeconds = parseTtlSeconds(options.ttlSeconds, DEFAULT_TTL_SECONDS);
    this.randomBytesFn = options.randomBytesFn ?? randomBytes;

    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  async issue(input: IssueInput): Promise<ConfirmationToken> {
    this.cleanupExpired();

    const ttlSeconds = parseTtlSeconds(input.ttlSeconds, this.ttlSeconds);
    const issuedAt = this.now();
    const expiresAt = issuedAt + ttlSeconds * 1000;
    const token = this.generateUniqueToken();

    this.entries.set(token, {
      token,
      sqlHash: input.sqlHash,
      normalizedSql: input.normalizedSql,
      datasource: input.context.datasource,
      database: normalizeDatabase(input.context.database),
      riskLevel: input.riskLevel,
      issuedAt,
      expiresAt,
    });

    return {
      token,
      issuedAt,
      expiresAt,
    };
  }

  async validate(
    token: string,
    currentSql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult> {
    const entry = this.entries.get(token);
    if (!entry) {
      return blockResult("CF001", "Confirmation token not found.");
    }

    const now = this.now();
    if (entry.expiresAt <= now) {
      this.entries.delete(token);
      return blockResult("CF002", "Confirmation token has expired.");
    }

    if (entry.usedAt !== undefined) {
      return blockResult("CF005", "Confirmation token has already been used.");
    }

    const normalizedCurrentSql = normalizeSql(currentSql);
    const currentSqlHash = sqlHash(normalizedCurrentSql);
    if (currentSqlHash !== entry.sqlHash) {
      return blockResult("CF003", "SQL hash mismatch for confirmation token.");
    }

    const currentDatabase = normalizeDatabase(ctx.database);
    if (ctx.datasource !== entry.datasource || currentDatabase !== entry.database) {
      return blockResult(
        "CF004",
        "Datasource or database mismatch for confirmation token.",
      );
    }

    entry.usedAt = now;
    return allowResult();
  }

  async revoke(token: string): Promise<void> {
    this.entries.delete(token);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  cleanupExpired(now = this.now()): void {
    for (const [token, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(token);
      }
    }
  }

  private generateUniqueToken(): string {
    for (let i = 0; i < 5; i += 1) {
      const token = `${TOKEN_PREFIX}${this.randomBytesFn(32).toString("base64url")}`;
      if (!this.entries.has(token)) {
        return token;
      }
    }
    throw new Error("Unable to generate unique confirmation token.");
  }
}

export function createConfirmationStore(
  options: ConfirmationStoreOptions = {},
): ConfirmationStore {
  return new InMemoryConfirmationStore(options);
}
