function dedupeCaseInsensitive(values) {
    const output = [];
    const seen = new Set();
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
function extractTables(ast) {
    return dedupeCaseInsensitive(ast.tables.map((table) => (table.schema ? `${table.schema}.${table.name}` : table.name)));
}
function extractColumns(ast) {
    return dedupeCaseInsensitive(ast.columns.map((column) => (column.table ? `${column.table}.${column.name}` : column.name)));
}
function extractStatementType(ast) {
    return ast.kind;
}
export function classifySql(ast, normalized, engine) {
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
