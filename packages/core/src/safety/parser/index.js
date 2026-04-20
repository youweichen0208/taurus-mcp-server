import nodeSqlParser from "node-sql-parser";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
const { Parser } = nodeSqlParser;
const AGGREGATE_FUNCTIONS = new Set([
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "GROUP_CONCAT",
    "STRING_AGG",
    "JSON_AGG",
    "ARRAY_AGG",
]);
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mapStatementType(value) {
    const type = typeof value === "string" ? value.toLowerCase() : "";
    switch (type) {
        case "select":
            return "select";
        case "show":
            return "show";
        case "explain":
            return "explain";
        case "desc":
        case "describe":
            return "describe";
        case "insert":
        case "replace":
            return "insert";
        case "update":
            return "update";
        case "delete":
            return "delete";
        case "alter":
            return "alter";
        case "drop":
            return "drop";
        case "create":
            return "create";
        case "grant":
            return "grant";
        case "revoke":
            return "revoke";
        case "truncate":
            return "truncate";
        case "set":
            return "set";
        case "use":
            return "use";
        default:
            return "unknown";
    }
}
function normalizeTableList(tableList) {
    const items = [];
    const seen = new Set();
    for (const entry of tableList) {
        const parts = entry.split("::");
        if (parts.length < 3) {
            continue;
        }
        const schema = parts[1] && parts[1] !== "null" ? parts[1] : undefined;
        const name = parts.slice(2).join("::").trim();
        if (!name) {
            continue;
        }
        const dedupeKey = `${schema ?? ""}.${name}`.toLowerCase();
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        items.push({ name, schema });
    }
    return items;
}
function normalizeColumnList(columnList) {
    const items = [];
    const seen = new Set();
    for (const entry of columnList) {
        const parts = entry.split("::");
        if (parts.length < 3) {
            continue;
        }
        const table = parts[1] && parts[1] !== "null" ? parts[1] : undefined;
        const name = parts.slice(2).join("::").trim();
        if (!name) {
            continue;
        }
        const dedupeKey = `${table ?? ""}.${name}`.toLowerCase();
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        items.push({ name, table });
    }
    return items;
}
function readNumericValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}
function toWhereNode(raw) {
    const type = isObject(raw) && typeof raw.type === "string" ? raw.type.toLowerCase() : "";
    return {
        kind: type === "binary_expr" ? "binary" : "expression",
        raw,
    };
}
function toLimitNode(raw) {
    if (!isObject(raw) || !Array.isArray(raw.value)) {
        return { raw };
    }
    const values = raw.value
        .map((entry) => {
        if (!isObject(entry)) {
            return undefined;
        }
        return readNumericValue(entry.value);
    })
        .filter((value) => value !== undefined);
    const rowCount = values.length > 0 ? values[values.length - 1] : undefined;
    const offset = values.length > 1 ? values[0] : undefined;
    return {
        raw,
        rowCount,
        offset,
    };
}
function getFunctionName(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const token = value
            .map((entry) => {
            if (typeof entry === "string") {
                return entry;
            }
            if (isObject(entry) && typeof entry.value === "string") {
                return entry.value;
            }
            return undefined;
        })
            .find((entry) => typeof entry === "string");
        return token;
    }
    if (isObject(value)) {
        if (typeof value.name === "string") {
            return value.name;
        }
        return getFunctionName(value.name);
    }
    return undefined;
}
function scanAst(statements) {
    let hasAggregate = false;
    let hasSubquery = false;
    const visit = (node, isTopLevelStatement, parentType, parentKey) => {
        if (Array.isArray(node)) {
            for (const entry of node) {
                visit(entry, false, parentType, parentKey);
            }
            return;
        }
        if (!isObject(node)) {
            return;
        }
        const nodeType = typeof node.type === "string" ? node.type.toLowerCase() : undefined;
        if (nodeType === "aggr_func") {
            hasAggregate = true;
        }
        else if (nodeType === "function") {
            const fn = getFunctionName(node.name);
            if (fn && AGGREGATE_FUNCTIONS.has(fn.toUpperCase())) {
                hasAggregate = true;
            }
        }
        if (nodeType === "select" && !isTopLevelStatement) {
            const isExplainPayload = parentType === "explain" && parentKey === "expr";
            if (!isExplainPayload) {
                hasSubquery = true;
            }
        }
        const currentType = typeof node.type === "string" ? node.type.toLowerCase() : undefined;
        for (const [key, value] of Object.entries(node)) {
            visit(value, false, currentType, key);
        }
    };
    for (const statement of statements) {
        visit(statement, true);
    }
    return { hasAggregate, hasSubquery };
}
function collectStructuredFeatures(statements) {
    let where;
    let limit;
    const joins = [];
    const orderBy = [];
    const groupBy = [];
    const roots = [];
    for (const statement of statements) {
        roots.push(statement);
        const statementType = typeof statement.type === "string" ? statement.type.toLowerCase() : "";
        if (statementType === "explain" && isObject(statement.expr)) {
            roots.push(statement.expr);
        }
    }
    for (const node of roots) {
        if (!where && node.where !== null && node.where !== undefined) {
            where = toWhereNode(node.where);
        }
        if (!limit && node.limit !== null && node.limit !== undefined) {
            limit = toLimitNode(node.limit);
        }
        if (Array.isArray(node.from)) {
            for (const fromEntry of node.from) {
                if (!isObject(fromEntry)) {
                    continue;
                }
                const joinType = typeof fromEntry.join === "string" ? fromEntry.join : undefined;
                if (!joinType) {
                    continue;
                }
                const tableName = typeof fromEntry.table === "string" ? fromEntry.table : undefined;
                const schemaName = typeof fromEntry.db === "string" ? fromEntry.db : undefined;
                joins.push({
                    type: joinType,
                    table: tableName ? { name: tableName, schema: schemaName ?? undefined } : undefined,
                    hasOn: fromEntry.on !== undefined && fromEntry.on !== null,
                });
            }
        }
        if (Array.isArray(node.orderby)) {
            for (const orderItem of node.orderby) {
                let direction;
                if (isObject(orderItem) && typeof orderItem.type === "string") {
                    direction = orderItem.type.toUpperCase();
                }
                orderBy.push({
                    direction,
                    raw: orderItem,
                });
            }
        }
        if (isObject(node.groupby) && Array.isArray(node.groupby.columns)) {
            for (const groupItem of node.groupby.columns) {
                groupBy.push({ raw: groupItem });
            }
        }
        else if (node.groupby !== null && node.groupby !== undefined) {
            groupBy.push({ raw: node.groupby });
        }
    }
    return { where, limit, joins, orderBy, groupBy };
}
function toParseError(error) {
    const typed = error;
    const message = typed instanceof Error ? typed.message : String(error);
    const line = typed.location?.start?.line;
    const column = typed.location?.start?.column;
    return {
        code: "SQL_PARSE_ERROR",
        message,
        position: typeof line === "number" && typeof column === "number"
            ? {
                line,
                column,
            }
            : undefined,
    };
}
export class NodeSqlParserAdapter {
    parser;
    engine;
    constructor(engine) {
        this.parser = new Parser();
        this.engine = engine;
    }
    normalize(sql) {
        const normalizedSql = normalizeSql(sql);
        return {
            normalizedSql,
            sqlHash: sqlHash(normalizedSql),
        };
    }
    parse(sql) {
        try {
            const rawAst = this.parser.astify(sql, { database: this.engine });
            const astEntries = Array.isArray(rawAst) ? rawAst : [rawAst];
            const statements = astEntries
                .filter((entry) => isObject(entry))
                .map((entry) => entry);
            const isMultiStatement = statements.length > 1;
            const statementKind = statements.length === 1 ? mapStatementType(statements[0].type) : "unknown";
            const tableList = this.parser.tableList(sql, { database: this.engine });
            const columnList = this.parser.columnList(sql, { database: this.engine });
            const scan = scanAst(statements);
            const structured = collectStructuredFeatures(statements);
            const ast = {
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
        }
        catch (error) {
            return {
                ok: false,
                error: toParseError(error),
            };
        }
    }
}
export function createSqlParser(engine) {
    return new NodeSqlParserAdapter(engine);
}
