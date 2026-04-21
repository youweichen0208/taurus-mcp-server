import { formatSuccess, type ToolResponse } from "../../utils/formatter.js";
import { formatToolError } from "../error-handling.js";
import type { ToolDefinition } from "../registry.js";
import {
  contextInputShape,
  metadata,
  resolveContext,
  toPublicFeatureMatrix,
  toPublicKernelInfo,
} from "../common.js";

export const getKernelInfoTool: ToolDefinition = {
  name: "get_kernel_info",
  description: "Detect whether the selected datasource is TaurusDB and return kernel metadata.",
  inputSchema: {
    datasource: contextInputShape.datasource,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const kernel = await deps.engine.getKernelInfo(ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          kernel: toPublicKernelInfo(kernel),
        },
        {
          summary: kernel.isTaurusDB
            ? `TaurusDB instance detected on datasource ${ctx.datasource}.`
            : `Datasource ${ctx.datasource} does not appear to be TaurusDB.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "get_kernel_info",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const listTaurusFeaturesTool: ToolDefinition = {
  name: "list_taurus_features",
  description:
    "Return the TaurusDB kernel info and feature matrix for the selected datasource. Works on non-TaurusDB instances by returning unavailable features.",
  inputSchema: {
    datasource: contextInputShape.datasource,
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const [kernel, features] = await Promise.all([
        deps.engine.getKernelInfo(ctx),
        deps.engine.listFeatures(ctx),
      ]);
      const availableCount = Object.values(features).filter((feature) => feature.available).length;
      const totalCount = Object.keys(features).length;

      return formatSuccess(
        {
          datasource: ctx.datasource,
          kernel: toPublicKernelInfo(kernel),
          features: toPublicFeatureMatrix(features),
        },
        {
          summary: kernel.isTaurusDB
            ? `TaurusDB instance detected. Kernel version ${kernel.kernelVersion ?? "unknown"}, ${availableCount} of ${totalCount} features available.`
            : `Datasource ${ctx.datasource} is not TaurusDB. Returning an unavailable feature matrix for compatibility discovery.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_taurus_features",
        metadata: metadata(context.taskId),
      });
    }
  },
};
