import type { SessionContext } from "../context/session-context.js";
import type { RiskLevel, ValidationResult } from "./sql-validator.js";
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
    validate(token: string, currentSql: string, ctx: SessionContext): Promise<ConfirmationValidationResult>;
    revoke(token: string): Promise<void>;
}
export type ConfirmationStoreOptions = {
    ttlSeconds?: number;
    cleanupIntervalMs?: number;
    now?: () => number;
    randomBytesFn?: (size: number) => Buffer;
};
export declare class InMemoryConfirmationStore implements ConfirmationStore {
    private readonly entries;
    private readonly now;
    private readonly ttlSeconds;
    private readonly randomBytesFn;
    private cleanupTimer?;
    constructor(options?: ConfirmationStoreOptions);
    issue(input: IssueInput): Promise<ConfirmationToken>;
    validate(token: string, currentSql: string, ctx: SessionContext): Promise<ConfirmationValidationResult>;
    revoke(token: string): Promise<void>;
    stop(): void;
    cleanupExpired(now?: number): void;
    private generateUniqueToken;
}
export declare function createConfirmationStore(options?: ConfirmationStoreOptions): ConfirmationStore;
