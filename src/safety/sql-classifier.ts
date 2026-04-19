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

function dedupeCaseInsensitive(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function extractTables(ast: SqlAst): string[] {
  return dedupeCaseInsensitive(
    ast.tables.map((table) => (table.schema ? `${table.schema}.${table.name}` : table.name)),
  );
}

function extractColumns(ast: SqlAst): string[] {
  return dedupeCaseInsensitive(
    ast.columns.map((column) => (column.table ? `${column.table}.${column.name}` : column.name)),
  );
}

function extractStatementType(ast: SqlAst): StatementType {
  return ast.kind;
}

export function classifySql(
  ast: SqlAst,
  normalized: NormalizedSql,
  engine: GuardrailEngine,
): SqlClassification {
  return {
    engine,
    statementType: extractStatementType(ast),
    normalizedSql: normalized.normalizedSql,
    sqlHash: normalized.sqlHash,
    isMultiStatement: ast.isMultiStatement,
    referencedTables: extractTables(ast),
    referencedColumns: extractColumns(ast),
    hasWhere: ast.where !== undefined,
    hasLimit: ast.limit !== undefined,
    hasJoin: (ast.joins?.length ?? 0) > 0,
    hasSubquery: ast.hasSubquery,
    hasOrderBy: (ast.orderBy?.length ?? 0) > 0,
    hasAggregate: ast.hasAggregate,
  };
}
