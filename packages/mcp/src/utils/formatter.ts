import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResponse } from "taurusdb-core";

export {
  ErrorCode,
  formatBlocked,
  formatConfirmationRequired,
  formatError,
  formatSuccess,
} from "taurusdb-core";
export type {
  ResponseMetadata,
  ToolError,
  ToolResponse,
} from "taurusdb-core";

export function toMcpToolResult<T>(response: ToolResponse<T>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
    structuredContent: response as unknown as Record<string, unknown>,
    isError: !response.ok,
  };
}
