export type StatementType = "select" | "show" | "explain" | "describe" | "insert" | "update" | "delete" | "alter" | "drop" | "create" | "grant" | "revoke" | "unknown";
export declare const ErrorCode: {
    readonly DATASOURCE_NOT_FOUND: "DATASOURCE_NOT_FOUND";
    readonly CREDENTIAL_MISSING: "CREDENTIAL_MISSING";
    readonly BLOCKED_SQL: "BLOCKED_SQL";
    readonly CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED";
    readonly CONFIRMATION_INVALID: "CONFIRMATION_INVALID";
    readonly SQL_SYNTAX_ERROR: "SQL_SYNTAX_ERROR";
    readonly QUERY_TIMEOUT: "QUERY_TIMEOUT";
    readonly QUERY_CANCELLED: "QUERY_CANCELLED";
    readonly CONNECTION_FAILED: "CONNECTION_FAILED";
    readonly RESULT_TOO_LARGE: "RESULT_TOO_LARGE";
};
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
export type ToolError = {
    code: ErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
};
export type ResponseMetadata = {
    task_id: string;
    sql_hash?: string;
    statement_type?: StatementType;
    duration_ms?: number;
};
export type ToolResponse<T = unknown> = {
    ok: boolean;
    summary: string;
    data?: T;
    error?: ToolError;
    metadata: ResponseMetadata;
};
export type FormatSuccessOptions = {
    summary: string;
    metadata: ResponseMetadata;
};
export type FormatErrorOptions<T = unknown> = {
    code: ErrorCode;
    message: string;
    summary: string;
    metadata: ResponseMetadata;
    retryable?: boolean;
    details?: Record<string, unknown>;
    data?: T;
};
export type FormatBlockedOptions = {
    reason: string;
    metadata: ResponseMetadata;
    summary?: string;
    details?: Record<string, unknown>;
};
export type FormatConfirmationRequiredOptions = {
    confirmationToken: string;
    metadata: ResponseMetadata;
    summary?: string;
    message?: string;
    riskLevel?: string;
    sqlHash?: string;
};
export declare function formatSuccess<T>(data: T, options: FormatSuccessOptions): ToolResponse<T>;
export declare function formatError<T = unknown>(options: FormatErrorOptions<T>): ToolResponse<T>;
export declare function formatBlocked(options: FormatBlockedOptions): ToolResponse;
export declare function formatConfirmationRequired(options: FormatConfirmationRequiredOptions): ToolResponse<{
    confirmation_token: string;
    risk_level?: string;
    sql_hash?: string;
}>;
