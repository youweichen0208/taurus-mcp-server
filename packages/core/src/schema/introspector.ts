import type { DatabaseEngine } from "../auth/sql-profile-loader.js";
import type { SessionContext } from "../context/session-context.js";

export interface DatabaseInfo {
  name: string;
  owner?: string;
  comment?: string;
}

export interface TableInfo {
  database: string;
  name: string;
  type?: "table" | "view" | "materialized_view";
  comment?: string;
  rowCountEstimate?: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: unknown;
  maxLength?: number;
  isPrimaryKey?: boolean;
  isIndexed?: boolean;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
}

export interface TableSchema {
  database: string;
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  primaryKey?: string[];
  engineHints?: {
    likelyTimeColumns: string[];
    likelyFilterColumns: string[];
    sensitiveColumns: string[];
  };
  comment?: string;
  rowCountEstimate?: number;
}

export interface SchemaAdapter {
  listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
  listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
  describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
}

export interface SchemaIntrospector {
  listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
  listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
  describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
}

export class SchemaIntrospectionError extends Error {
  readonly code: "SCHEMA_ADAPTER_NOT_FOUND" | "INVALID_INTROSPECTION_INPUT";

  constructor(code: "SCHEMA_ADAPTER_NOT_FOUND" | "INVALID_INTROSPECTION_INPUT", message: string) {
    super(message);
    this.name = "SchemaIntrospectionError";
    this.code = code;
  }
}

export type SchemaIntrospectorOptions = {
  adapters: Partial<Record<DatabaseEngine, SchemaAdapter>>;
};

function normalizeName(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SchemaIntrospectionError(
      "INVALID_INTROSPECTION_INPUT",
      `Invalid ${fieldName}: value cannot be empty.`,
    );
  }
  return trimmed;
}

export class AdapterSchemaIntrospector implements SchemaIntrospector {
  private readonly adapters: Partial<Record<DatabaseEngine, SchemaAdapter>>;

  constructor(options: SchemaIntrospectorOptions) {
    this.adapters = options.adapters;
  }

  async listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]> {
    return this.getAdapter(ctx.engine).listDatabases(ctx);
  }

  async listTables(ctx: SessionContext, database: string): Promise<TableInfo[]> {
    return this.getAdapter(ctx.engine).listTables(ctx, normalizeName(database, "database"));
  }

  async describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema> {
    return this.getAdapter(ctx.engine).describeTable(
      ctx,
      normalizeName(database, "database"),
      normalizeName(table, "table"),
    );
  }

  private getAdapter(engine: DatabaseEngine): SchemaAdapter {
    const adapter = this.adapters[engine];
    if (!adapter) {
      throw new SchemaIntrospectionError(
        "SCHEMA_ADAPTER_NOT_FOUND",
        `Schema adapter not found for engine "${engine}".`,
      );
    }
    return adapter;
  }
}

export function createSchemaIntrospector(options: SchemaIntrospectorOptions): SchemaIntrospector {
  return new AdapterSchemaIntrospector(options);
}
