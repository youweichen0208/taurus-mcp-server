export type StatementType =
  | "select"
  | "show"
  | "explain"
  | "describe"
  | "insert"
  | "update"
  | "delete"
  | "alter"
  | "drop"
  | "create"
  | "grant"
  | "revoke"
  | "unknown";

export const ErrorCode = {
  DATASOURCE_NOT_FOUND: "DATASOURCE_NOT_FOUND",
  CREDENTIAL_MISSING: "CREDENTIAL_MISSING",
  BLOCKED_SQL: "BLOCKED_SQL",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  CONFIRMATION_INVALID: "CONFIRMATION_INVALID",
  INVALID_INPUT: "INVALID_INPUT",
  SQL_SYNTAX_ERROR: "SQL_SYNTAX_ERROR",
  QUERY_TIMEOUT: "QUERY_TIMEOUT",
  QUERY_CANCELLED: "QUERY_CANCELLED",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  DB_ENDPOINT_UNREACHABLE: "DB_ENDPOINT_UNREACHABLE",
  DB_CONNECTION_REFUSED: "DB_CONNECTION_REFUSED",
  DB_TLS_FAILED: "DB_TLS_FAILED",
  DB_AUTH_FAILED: "DB_AUTH_FAILED",
  DB_VALIDATION_TIMEOUT: "DB_VALIDATION_TIMEOUT",
  RESULT_TOO_LARGE: "RESULT_TOO_LARGE",
  AUDIT_FAILED: "AUDIT_FAILED",
  SERVER_BUSY: "SERVER_BUSY",
  UNSUPPORTED_FEATURE: "UNSUPPORTED_FEATURE",
  FLASHBACK_VIEW_UNAVAILABLE: "FLASHBACK_VIEW_UNAVAILABLE",
} as const;

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
  approvalRequest: string;
  requestId: string;
  metadata: ResponseMetadata;
  summary?: string;
  message?: string;
  riskLevel?: string;
  sqlHash?: string;
};

export function formatSuccess<T>(data: T, options: FormatSuccessOptions): ToolResponse<T> {
  return {
    ok: true,
    summary: options.summary,
    data,
    metadata: options.metadata,
  };
}

export function formatError<T = unknown>(options: FormatErrorOptions<T>): ToolResponse<T> {
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

export function formatBlocked(options: FormatBlockedOptions): ToolResponse {
  return formatError({
    code: ErrorCode.BLOCKED_SQL,
    message: options.reason,
    summary: options.summary ?? "The SQL statement is blocked by safety policy.",
    retryable: false,
    details: options.details,
    metadata: options.metadata,
  });
}

export function formatConfirmationRequired(
  options: FormatConfirmationRequiredOptions,
): ToolResponse<{
  approval_request: string;
  request_id: string;
  risk_level?: string;
  sql_hash?: string;
}> {
  return formatError({
    code: ErrorCode.CONFIRMATION_REQUIRED,
    message:
      options.message ??
      "An external operator must sign approval_request with `taurusdb-mcp approve` before retrying with approval_token.",
    summary: options.summary ?? "This SQL will modify data and requires external human approval.",
    retryable: true,
    metadata: options.metadata,
    data: {
      approval_request: options.approvalRequest,
      request_id: options.requestId,
      risk_level: options.riskLevel,
      sql_hash: options.sqlHash,
    },
  });
}
