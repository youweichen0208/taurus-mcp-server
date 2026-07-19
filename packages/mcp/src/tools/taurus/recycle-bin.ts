import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  contextInputShape,
  metadata,
  resolveContext,
  summarizeRows,
  toPublicQueryResult,
} from "../common.js";

export const listRecycleBinTool: ToolDefinition = {
  name: "list_recycle_bin",
  description:
    "List TaurusDB recycle bin tables. This is readonly and is intended for recovery triage after accidental DROP TABLE.",
  inputSchema: {
    datasource: contextInputShape.datasource,
    timeout_ms: contextInputShape.timeout_ms,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const result = await deps.engine.listRecycleBin(ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          ...toPublicQueryResult(result),
        },
        {
          summary: summarizeRows(result.rowCount, result.truncated),
          metadata: metadata(context.taskId, {
            statement_type: "show",
            duration_ms: result.durationMs,
          }),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_recycle_bin",
        metadata: metadata(context.taskId, {
          statement_type: "show",
        }),
      });
    }
  },
};
