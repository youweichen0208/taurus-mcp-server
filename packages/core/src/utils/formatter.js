export const ErrorCode = {
    DATASOURCE_NOT_FOUND: "DATASOURCE_NOT_FOUND",
    CREDENTIAL_MISSING: "CREDENTIAL_MISSING",
    BLOCKED_SQL: "BLOCKED_SQL",
    CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
    CONFIRMATION_INVALID: "CONFIRMATION_INVALID",
    SQL_SYNTAX_ERROR: "SQL_SYNTAX_ERROR",
    QUERY_TIMEOUT: "QUERY_TIMEOUT",
    QUERY_CANCELLED: "QUERY_CANCELLED",
    CONNECTION_FAILED: "CONNECTION_FAILED",
    RESULT_TOO_LARGE: "RESULT_TOO_LARGE",
};
export function formatSuccess(data, options) {
    return {
        ok: true,
        summary: options.summary,
        data,
        metadata: options.metadata,
    };
}
export function formatError(options) {
    return {
        ok: false,
        summary: options.summary,
        data: options.data,
        error: {
            code: options.code,
            message: options.message,
            retryable: options.retryable,
            details: options.details,
        },
        metadata: options.metadata,
    };
}
export function formatBlocked(options) {
    return formatError({
        code: ErrorCode.BLOCKED_SQL,
        message: options.reason,
        summary: options.summary ?? "The SQL statement is blocked by safety policy.",
        retryable: false,
        details: options.details,
        metadata: options.metadata,
    });
}
export function formatConfirmationRequired(options) {
    return formatError({
        code: ErrorCode.CONFIRMATION_REQUIRED,
        message: options.message ?? "Re-run the same SQL with confirmation_token to continue.",
        summary: options.summary ?? "This SQL will modify data and requires explicit confirmation.",
        retryable: true,
        metadata: options.metadata,
        data: {
            confirmation_token: options.confirmationToken,
            risk_level: options.riskLevel,
            sql_hash: options.sqlHash,
        },
    });
}
