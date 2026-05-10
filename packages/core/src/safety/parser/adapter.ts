import nodeSqlParser from "node-sql-parser";
import type { Parser as ParserType } from "node-sql-parser";
import type { DatabaseEngine } from "../../auth/sql-profile-loader.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import { collectStructuredFeatures, scanAst } from "./features.js";
import { isObject, mapStatementType, normalizeColumnList, normalizeTableList, toParseError } from "./ast-utils.js";
import type { AstNode, NormalizedSql, ParseResult, SqlAst, SqlParser } from "./types.js";

const { Parser } = nodeSqlParser;

export class NodeSqlParserAdapter implements SqlParser {
  private readonly parser: ParserType;
  private readonly engine: DatabaseEngine;

  constructor(engine: DatabaseEngine) {
    this.parser = new Parser();
    this.engine = engine;
  }

  normalize(sql: string): NormalizedSql {
    const normalizedSql = normalizeSql(sql);
    return {
      normalizedSql,
      sqlHash: sqlHash(normalizedSql),
    };
  }

  parse(sql: string): ParseResult {
    try {
      const rawAst = this.parser.astify(sql, { database: this.engine });
      const astEntries = Array.isArray(rawAst) ? rawAst : [rawAst];
      const statements: AstNode[] = astEntries
        .filter((entry) => isObject(entry))
        .map((entry) => entry as unknown as AstNode);

      const isMultiStatement = statements.length > 1;
      const statementKind =
        statements.length === 1 ? mapStatementType(statements[0].type) : "unknown";

      const tableList = this.parser.tableList(sql, { database: this.engine });
      const columnList = this.parser.columnList(sql, { database: this.engine });
      const scan = scanAst(statements);
      const structured = collectStructuredFeatures(statements);

      const ast: SqlAst = {
        kind: statementKind,
        tables: normalizeTableList(tableList),
        columns: normalizeColumnList(columnList),
        hasAggregate: scan.hasAggregate,
        hasSubquery: scan.hasSubquery,
        isMultiStatement,
      };

      if (structured.where) {
        ast.where = structured.where;
      }
      if (structured.limit) {
        ast.limit = structured.limit;
      }
      if (structured.joins.length > 0) {
        ast.joins = structured.joins;
      }
      if (structured.orderBy.length > 0) {
        ast.orderBy = structured.orderBy;
      }
      if (structured.groupBy.length > 0) {
        ast.groupBy = structured.groupBy;
      }

      return {
        ok: true,
        ast,
        isMultiStatement,
      };
    } catch (error) {
      return {
        ok: false,
        error: toParseError(error),
      };
    }
  }
}

export function createSqlParser(engine: DatabaseEngine): SqlParser {
  return new NodeSqlParserAdapter(engine);
}
