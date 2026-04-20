import type { DatabaseEngine } from "../../auth/sql-profile-loader.js";
export type StatementType = "select" | "show" | "explain" | "describe" | "insert" | "update" | "delete" | "alter" | "drop" | "create" | "grant" | "revoke" | "truncate" | "set" | "use" | "unknown";
export interface TableRef {
    name: string;
    schema?: string;
}
export interface ColumnRef {
    name: string;
    table?: string;
}
export interface WhereNode {
    kind: "binary" | "expression";
    raw: unknown;
}
export interface LimitNode {
    raw: unknown;
    rowCount?: number;
    offset?: number;
}
export interface JoinNode {
    type?: string;
    table?: TableRef;
    hasOn?: boolean;
}
export interface OrderByNode {
    direction?: string;
    raw: unknown;
}
export interface GroupByNode {
    raw: unknown;
}
export interface SqlAst {
    kind: StatementType;
    tables: TableRef[];
    columns: ColumnRef[];
    where?: WhereNode;
    limit?: LimitNode;
    joins?: JoinNode[];
    orderBy?: OrderByNode[];
    groupBy?: GroupByNode[];
    hasAggregate: boolean;
    hasSubquery: boolean;
    isMultiStatement: boolean;
}
export interface NormalizedSql {
    normalizedSql: string;
    sqlHash: string;
}
export interface ParseError {
    code: "SQL_PARSE_ERROR";
    message: string;
    position?: {
        line: number;
        column: number;
    };
}
export type ParseResult = {
    ok: true;
    ast: SqlAst;
    isMultiStatement: boolean;
} | {
    ok: false;
    error: ParseError;
};
export interface SqlParser {
    normalize(sql: string): NormalizedSql;
    parse(sql: string): ParseResult;
}
export declare class NodeSqlParserAdapter implements SqlParser {
    private readonly parser;
    private readonly engine;
    constructor(engine: DatabaseEngine);
    normalize(sql: string): NormalizedSql;
    parse(sql: string): ParseResult;
}
export declare function createSqlParser(engine: DatabaseEngine): SqlParser;
