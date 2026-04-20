import type { DatabaseEngine } from "../auth/sql-profile-loader.js";
import type { NormalizedSql, SqlAst, StatementType } from "./parser/index.js";
export type GuardrailEngine = DatabaseEngine | "unknown";
export interface SqlClassification {
    engine: GuardrailEngine;
    statementType: StatementType;
    normalizedSql: string;
    sqlHash: string;
    isMultiStatement: boolean;
    referencedTables: string[];
    referencedColumns: string[];
    hasWhere: boolean;
    hasLimit: boolean;
    hasJoin: boolean;
    hasSubquery: boolean;
    hasOrderBy: boolean;
    hasAggregate: boolean;
}
export declare function classifySql(ast: SqlAst, normalized: NormalizedSql, engine: GuardrailEngine): SqlClassification;
