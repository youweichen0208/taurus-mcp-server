import { ConnectionPoolError } from "../executor/connection-pool.js";
import { DatasourceResolutionError } from "../context/datasource-resolver.js";
import { SchemaIntrospectionError } from "../schema/introspector.js";
import {
  ErrorCode,
  formatError,
  type ResponseMetadata,
  type ToolResponse,
} from "../utils/formatter.js";

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

export function formatToolError(error: unknown, context: ToolErrorContext): ToolResponse {
  if (error instanceof DatasourceResolutionError) {
    if (error.code === "DATASOURCE_NOT_FOUND") {
      return formatError({
        code: ErrorCode.DATASOURCE_NOT_FOUND,
        message: `${error.message} Call list_data_sources to inspect available datasources.`,
        summary: `${context.action} failed because datasource could not be resolved.`,
        metadata: context.metadata,
      });
    }
    return formatError({
      code: ErrorCode.SQL_SYNTAX_ERROR,
      message: error.message,
      summary: `${context.action} failed due to invalid input.`,
      metadata: context.metadata,
    });
  }

  if (error instanceof SchemaIntrospectionError) {
    if (error.code === "INVALID_INTROSPECTION_INPUT") {
      return formatError({
        code: ErrorCode.SQL_SYNTAX_ERROR,
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

  return formatError({
    code: ErrorCode.CONNECTION_FAILED,
    message: messageOf(error),
    summary: `${context.action} failed unexpectedly.`,
    metadata: context.metadata,
  });
}
