import {
  ConnectionPoolError,
  DatasourceResolutionError,
  FlashbackNoViewError,
  logger,
  QueryConcurrencyError,
  SchemaIntrospectionError,
  UnsupportedFeatureError,
} from "taurusdb-core";
import {
  ErrorCode,
  formatError,
  type ResponseMetadata,
  type ToolResponse,
} from "../utils/formatter.js";

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

type ToolErrorContext = {
  action: string;
  metadata: ResponseMetadata;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeoutLikely(error: unknown): boolean {
  return /timeout|timed out/i.test(messageOf(error));
}

function cancelledLikely(error: unknown): boolean {
  return /cancelled|canceled/i.test(messageOf(error));
}

function detailsOf(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object" || !("details" in error)) {
    return undefined;
  }
  const details = (error as { details?: unknown }).details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined;
}

export function formatToolError(error: unknown, context: ToolErrorContext): ToolResponse {
  if (error instanceof ToolInputError) {
    return formatError({
      code: ErrorCode.INVALID_INPUT,
      message: error.message,
      summary: `${context.action} failed due to invalid input.`,
      metadata: context.metadata,
    });
  }

  if (error instanceof DatasourceResolutionError) {
    if (error.code === "DATASOURCE_NOT_FOUND") {
      return formatError({
        code: ErrorCode.DATASOURCE_NOT_FOUND,
        message: `${error.message} Verify the active datasource template or pass an explicit datasource name.`,
        summary: `${context.action} failed because datasource could not be resolved.`,
        metadata: context.metadata,
      });
    }
    return formatError({
      code: ErrorCode.INVALID_INPUT,
      message: error.message,
      summary: `${context.action} failed due to invalid input.`,
      metadata: context.metadata,
    });
  }

  if (error instanceof SchemaIntrospectionError) {
    if (error.code === "INVALID_INTROSPECTION_INPUT") {
      return formatError({
        code: ErrorCode.INVALID_INPUT,
        message: error.message,
        summary: `${context.action} failed due to invalid schema input.`,
        metadata: context.metadata,
      });
    }
    return formatError({
      code: ErrorCode.CONNECTION_FAILED,
      message: error.message,
      summary: `${context.action} failed because schema adapter is unavailable.`,
      metadata: context.metadata,
    });
  }

  if (error instanceof ConnectionPoolError) {
    return formatError({
      code: ErrorCode.CONNECTION_FAILED,
      message: error.message,
      summary: `${context.action} failed due to database connection issue.`,
      metadata: context.metadata,
      details: detailsOf(error),
    });
  }

  if (error instanceof UnsupportedFeatureError) {
    const parameterHint = error.parameterHint
      ? ` Enable or verify ${error.parameterHint} on the target instance if this feature should be available.`
      : "";
    return formatError({
      code: ErrorCode.UNSUPPORTED_FEATURE,
      message: `${error.message}${parameterHint}`,
      summary: "The requested TaurusDB feature is not available on this instance.",
      metadata: context.metadata,
      details: {
        feature: error.feature,
        required_version: error.requiredVersion,
        current_version: error.currentVersion,
        parameter_hint: error.parameterHint,
      },
    });
  }

  if (error instanceof FlashbackNoViewError) {
    return formatError({
      code: ErrorCode.CONNECTION_FAILED,
      message: error.message,
      summary:
        "No historical flashback view was available for the requested timestamp.",
      metadata: context.metadata,
      details: detailsOf(error),
    });
  }

  if (error instanceof QueryConcurrencyError) {
    return formatError({
      code: ErrorCode.SERVER_BUSY,
      message: error.message,
      summary: `${context.action} could not start because query capacity is exhausted.`,
      metadata: context.metadata,
      retryable: true,
    });
  }

  if (cancelledLikely(error)) {
    return formatError({
      code: ErrorCode.QUERY_CANCELLED,
      message: messageOf(error),
      summary: `${context.action} was cancelled.`,
      metadata: context.metadata,
    });
  }

  if (timeoutLikely(error)) {
    return formatError({
      code: ErrorCode.QUERY_TIMEOUT,
      message: messageOf(error),
      summary: `${context.action} timed out.`,
      metadata: context.metadata,
    });
  }

  logger.error(
    { err: error, action: context.action },
    "Tool execution failed unexpectedly",
  );
  return formatError({
    code: ErrorCode.CONNECTION_FAILED,
    message: `${context.action} failed unexpectedly.`,
    summary: `${context.action} failed unexpectedly.`,
    metadata: context.metadata,
  });
}
