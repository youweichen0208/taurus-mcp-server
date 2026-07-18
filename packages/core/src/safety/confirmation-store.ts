import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { SessionContext } from "../context/session-context.js";
import { normalizeSql, sqlHash } from "../utils/hash.js";
import type { RiskLevel, ValidationResult } from "./sql-validator.js";

const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const REQUEST_PREFIX = "creq_";
const TOKEN_PREFIX = "ctok_";

export type ApprovalRequestPayload = {
  version: 1;
  requestId: string;
  sqlHash: string;
  datasource: string;
  database?: string;
  host?: string;
  port?: number;
  projectId?: string;
  instanceId?: string;
  nodeId?: string;
  riskLevel: RiskLevel;
  issuedAt: number;
  expiresAt: number;
};

type ApprovalTokenPayload = ApprovalRequestPayload & {
  actor: string;
};

type StoredConfirmation = {
  payload: ApprovalRequestPayload;
  usedAt?: number;
};

export type IssueInput = {
  sqlHash: string;
  normalizedSql: string;
  context: SessionContext;
  riskLevel: RiskLevel;
  ttlSeconds?: number;
};

export type ConfirmationRequest = {
  request: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
};

export type ConfirmationValidationResult = ValidationResult & {
  valid: boolean;
  actor?: string;
  reason?: string;
};

export interface ConfirmationStore {
  issue(input: IssueInput): Promise<ConfirmationRequest>;
  validate(
    token: string,
    currentSql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult>;
  revoke(requestId: string): Promise<void>;
}

export type ConfirmationStoreOptions = {
  approvalSecret?: string | Buffer;
  ttlSeconds?: number;
  cleanupIntervalMs?: number;
  maxEntries?: number;
  now?: () => number;
  randomBytesFn?: (size: number) => Buffer;
};

function allowResult(actor: string): ConfirmationValidationResult {
  return {
    valid: true,
    actor,
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

function parseMaxEntries(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error("maxEntries must be a positive integer.");
  }
  return resolved;
}

function encodePayload(payload: ApprovalRequestPayload | ApprovalTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeJson<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

function normalizeSecret(secret: string | Buffer | undefined): Buffer | undefined {
  if (secret === undefined) {
    return undefined;
  }
  const normalized = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(secret, "utf8");
  if (normalized.length < 32) {
    throw new Error("Mutation approval secret must contain at least 32 bytes.");
  }
  return normalized;
}

function signEncodedPayload(encodedPayload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

export function parseApprovalRequest(request: string): ApprovalRequestPayload {
  if (!request.startsWith(REQUEST_PREFIX)) {
    throw new Error("Invalid approval request prefix.");
  }
  const payload = decodeJson<ApprovalRequestPayload>(request.slice(REQUEST_PREFIX.length));
  if (
    payload.version !== 1 ||
    typeof payload.requestId !== "string" ||
    typeof payload.sqlHash !== "string" ||
    typeof payload.datasource !== "string" ||
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number"
  ) {
    throw new Error("Invalid approval request payload.");
  }
  return payload;
}

export function signApprovalRequest(
  request: string,
  actor: string,
  secret: string | Buffer,
): string {
  const normalizedActor = actor.trim();
  if (!normalizedActor) {
    throw new Error("Approval actor is required.");
  }
  const requestPayload = parseApprovalRequest(request);
  const payload: ApprovalTokenPayload = {
    ...requestPayload,
    actor: normalizedActor,
  };
  const encodedPayload = encodePayload(payload);
  const signature = signEncodedPayload(encodedPayload, normalizeSecret(secret)!);
  return `${TOKEN_PREFIX}${encodedPayload}.${signature.toString("base64url")}`;
}

function equalRequestPayload(
  pending: ApprovalRequestPayload,
  signed: ApprovalTokenPayload,
): boolean {
  return (
    pending.version === signed.version &&
    pending.requestId === signed.requestId &&
    pending.sqlHash === signed.sqlHash &&
    pending.datasource === signed.datasource &&
    pending.database === signed.database &&
    pending.host === signed.host &&
    pending.port === signed.port &&
    pending.projectId === signed.projectId &&
    pending.instanceId === signed.instanceId &&
    pending.nodeId === signed.nodeId &&
    pending.riskLevel === signed.riskLevel &&
    pending.issuedAt === signed.issuedAt &&
    pending.expiresAt === signed.expiresAt
  );
}

export class InMemoryConfirmationStore implements ConfirmationStore {
  private readonly entries = new Map<string, StoredConfirmation>();
  private readonly now: () => number;
  private readonly ttlSeconds: number;
  private readonly maxEntries: number;
  private readonly randomBytesFn: (size: number) => Buffer;
  private readonly approvalSecret?: Buffer;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: ConfirmationStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlSeconds = parseTtlSeconds(options.ttlSeconds, DEFAULT_TTL_SECONDS);
    this.maxEntries = parseMaxEntries(options.maxEntries);
    this.randomBytesFn = options.randomBytesFn ?? randomBytes;
    this.approvalSecret = normalizeSecret(options.approvalSecret);

    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  async issue(input: IssueInput): Promise<ConfirmationRequest> {
    this.cleanupExpired();
    if (this.entries.size >= this.maxEntries) {
      throw new Error("Too many pending mutation approval requests.");
    }

    const ttlSeconds = parseTtlSeconds(input.ttlSeconds, this.ttlSeconds);
    const issuedAt = this.now();
    const expiresAt = issuedAt + ttlSeconds * 1000;
    const requestId = this.generateUniqueRequestId();
    const payload: ApprovalRequestPayload = {
      version: 1,
      requestId,
      sqlHash: input.sqlHash,
      datasource: input.context.datasource,
      database: normalizeDatabase(input.context.database),
      host: input.context.host,
      port: input.context.port,
      projectId: input.context.projectId,
      instanceId: input.context.instanceId,
      nodeId: input.context.nodeId,
      riskLevel: input.riskLevel,
      issuedAt,
      expiresAt,
    };
    this.entries.set(requestId, { payload });
    return {
      request: `${REQUEST_PREFIX}${encodePayload(payload)}`,
      requestId,
      issuedAt,
      expiresAt,
    };
  }

  async validate(
    token: string,
    currentSql: string,
    ctx: SessionContext,
  ): Promise<ConfirmationValidationResult> {
    if (!this.approvalSecret) {
      return blockResult("CF006", "External mutation approval is not configured.");
    }
    if (!token.startsWith(TOKEN_PREFIX)) {
      return blockResult("CF001", "Invalid approval token prefix.");
    }
    const [encodedPayload, encodedSignature, ...extra] = token
      .slice(TOKEN_PREFIX.length)
      .split(".");
    if (!encodedPayload || !encodedSignature || extra.length > 0) {
      return blockResult("CF001", "Invalid approval token format.");
    }

    let payload: ApprovalTokenPayload;
    let signature: Buffer;
    try {
      payload = decodeJson<ApprovalTokenPayload>(encodedPayload);
      signature = Buffer.from(encodedSignature, "base64url");
    } catch {
      return blockResult("CF001", "Invalid approval token encoding.");
    }
    const expectedSignature = signEncodedPayload(encodedPayload, this.approvalSecret);
    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(signature, expectedSignature)
    ) {
      return blockResult("CF007", "Approval token signature is invalid.");
    }
    if (typeof payload.actor !== "string" || !payload.actor.trim()) {
      return blockResult("CF008", "Approval token does not identify an actor.");
    }

    const entry = this.entries.get(payload.requestId);
    if (!entry) {
      return blockResult("CF001", "Approval request not found.");
    }
    const now = this.now();
    if (entry.payload.expiresAt <= now || payload.expiresAt <= now) {
      this.entries.delete(payload.requestId);
      return blockResult("CF002", "Approval request has expired.");
    }
    if (entry.usedAt !== undefined) {
      return blockResult("CF005", "Approval token has already been used.");
    }
    if (!equalRequestPayload(entry.payload, payload)) {
      return blockResult("CF009", "Approval token payload does not match the pending request.");
    }

    const normalizedCurrentSql = normalizeSql(currentSql);
    if (sqlHash(normalizedCurrentSql) !== payload.sqlHash) {
      return blockResult("CF003", "SQL hash mismatch for approval token.");
    }
    const currentDatabase = normalizeDatabase(ctx.database);
    if (
      ctx.datasource !== payload.datasource ||
      currentDatabase !== payload.database ||
      ctx.host !== payload.host ||
      ctx.port !== payload.port ||
      ctx.projectId !== payload.projectId ||
      ctx.instanceId !== payload.instanceId ||
      ctx.nodeId !== payload.nodeId
    ) {
      return blockResult("CF004", "Datasource, database, or target mismatch for approval token.");
    }

    entry.usedAt = now;
    return allowResult(payload.actor.trim());
  }

  async revoke(requestId: string): Promise<void> {
    this.entries.delete(requestId);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  cleanupExpired(now = this.now()): void {
    for (const [requestId, entry] of this.entries.entries()) {
      if (entry.payload.expiresAt <= now) {
        this.entries.delete(requestId);
      }
    }
  }

  private generateUniqueRequestId(): string {
    for (let i = 0; i < 5; i += 1) {
      const requestId = this.randomBytesFn(24).toString("base64url");
      if (!this.entries.has(requestId)) {
        return requestId;
      }
    }
    throw new Error("Unable to generate unique approval request id.");
  }
}

export function createConfirmationStore(
  options: ConfirmationStoreOptions = {},
): ConfirmationStore {
  return new InMemoryConfirmationStore(options);
}
