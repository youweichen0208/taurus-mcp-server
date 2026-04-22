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
export declare class SchemaIntrospectionError extends Error {
    readonly code: "SCHEMA_ADAPTER_NOT_FOUND" | "INVALID_INTROSPECTION_INPUT";
    constructor(code: "SCHEMA_ADAPTER_NOT_FOUND" | "INVALID_INTROSPECTION_INPUT", message: string);
}
export type SchemaIntrospectorOptions = {
    adapters: Partial<Record<DatabaseEngine, SchemaAdapter>>;
};
export declare class AdapterSchemaIntrospector implements SchemaIntrospector {
    private readonly adapters;
    constructor(options: SchemaIntrospectorOptions);
    listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
    listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
    describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
    private getAdapter;
}
export declare function createSchemaIntrospector(options: SchemaIntrospectorOptions): SchemaIntrospector;
