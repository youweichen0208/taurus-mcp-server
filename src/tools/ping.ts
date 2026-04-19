import { formatSuccess } from "../utils/formatter.js";
import type { ToolDefinition } from "./registry.js";

const PING_DESCRIPTION = "Connectivity smoke test. Returns `pong` when the server is alive.";

export const pingTool: ToolDefinition<Record<string, unknown>, { value: string }> = {
  name: "ping",
  description: PING_DESCRIPTION,
  inputSchema: {},
  async handler(_input, deps, context) {
    return formatSuccess(
      { value: deps.pingResponse },
      {
        summary: deps.pingResponse,
        metadata: { task_id: context.taskId },
      },
    );
  },
};
