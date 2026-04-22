import { z } from "zod";
import { formatSuccess, type ToolResponse } from "../utils/formatter.js";
import { formatToolError } from "./error-handling.js";
import type { ToolDefinition } from "./registry.js";
import {
  contextInputShape,
  metadata,
  requireDatabase,
  resolveContext,
  toPublicDataSourceInfo,
  toPublicDatabaseInfo,
  toPublicTableInfo,
  toPublicTableSchema,
  asRequiredString,
} from "./common.js";

export const listDataSourcesTool: ToolDefinition = {
  name: "list_data_sources",
  description: "List all configured datasource profiles and indicate the current default datasource.",
  inputSchema: {},
  async handler(_input, deps, context): Promise<ToolResponse> {
    try {
      const [items, defaultDatasource] = await Promise.all([
        deps.engine.listDataSources(),
        deps.engine.getDefaultDataSource(),
      ]);

      return formatSuccess(
        {
          items: items.map(toPublicDataSourceInfo),
          default_datasource: defaultDatasource,
        },
        {
          summary: `Resolved ${items.length} datasource profiles.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_data_sources",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const listDatabasesTool: ToolDefinition = {
  name: "list_databases",
  description: "List databases available on the selected datasource.",
  inputSchema: contextInputShape,
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const items = await deps.engine.listDatabases(ctx);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          database: ctx.database,
          items: items.map(toPublicDatabaseInfo),
        },
        {
          summary: `Resolved ${items.length} databases from datasource ${ctx.datasource}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_databases",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const listTablesTool: ToolDefinition = {
  name: "list_tables",
  description: "List tables or views in the selected database.",
  inputSchema: contextInputShape,
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const database = requireDatabase(input.database, ctx);
      const items = await deps.engine.listTables(ctx, database);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          database,
          items: items.map(toPublicTableInfo),
        },
        {
          summary: `Resolved ${items.length} tables from ${database}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "list_tables",
        metadata: metadata(context.taskId),
      });
    }
  },
};

export const describeTableTool: ToolDefinition = {
  name: "describe_table",
  description: "Describe a table, including columns, indexes, primary key, and engine hints.",
  inputSchema: {
    ...contextInputShape,
    table: asRequiredStringSchema("Table name to describe."),
  },
  async handler(input, deps, context): Promise<ToolResponse> {
    try {
      const ctx = await resolveContext(input, deps, context, true);
      const database = requireDatabase(input.database, ctx);
      const table = asRequiredString(input.table, "table");
      const schema = await deps.engine.describeTable(ctx, database, table);
      return formatSuccess(
        {
          datasource: ctx.datasource,
          ...toPublicTableSchema(schema),
        },
        {
          summary: `Described ${database}.${table}.`,
          metadata: metadata(context.taskId),
        },
      );
    } catch (error) {
      return formatToolError(error, {
        action: "describe_table",
        metadata: metadata(context.taskId),
      });
    }
  },
};

function asRequiredStringSchema(description: string) {
  return z.string().trim().min(1).describe(description);
}
