import type { ConnectionPool } from "../../executor/connection-pool.js";
import type { SessionContext } from "../../context/session-context.js";
import type { SchemaCache } from "../cache.js";
import type { DatabaseInfo, SampleResult, SchemaAdapter, TableInfo, TableSchema } from "../introspector.js";
export type MySqlSchemaAdapterOptions = {
    connectionPool: ConnectionPool;
    schemaCache?: SchemaCache;
};
export declare class MySqlSchemaAdapter implements SchemaAdapter {
    private readonly connectionPool;
    private readonly schemaCache?;
    constructor(options: MySqlSchemaAdapterOptions);
    listDatabases(ctx: SessionContext): Promise<DatabaseInfo[]>;
    listTables(ctx: SessionContext, database: string): Promise<TableInfo[]>;
    describeTable(ctx: SessionContext, database: string, table: string): Promise<TableSchema>;
    sampleRows(ctx: SessionContext, database: string, table: string, n: number): Promise<SampleResult>;
    private mapIndexes;
    private queryObjects;
}
export declare function createMySqlSchemaAdapter(options: MySqlSchemaAdapterOptions): SchemaAdapter;
