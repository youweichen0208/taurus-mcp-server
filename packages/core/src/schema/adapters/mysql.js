const SENSITIVE_PATTERNS = [
    /phone|mobile|tel/i,
    /id_?card|passport|ssn/i,
    /email/i,
    /password|passwd|secret/i,
    /token|api_?key/i,
    /bank|card_?no|account/i,
];
const TIME_COLUMN_PATTERNS = [
    /created(_at|_time)?$/i,
    /updated(_at|_time)?$/i,
    /modified(_at|_time)?$/i,
    /event(_at|_time)?$/i,
    /timestamp/i,
    /date$/i,
    /time$/i,
];
const TIME_DATA_TYPES = new Set(["date", "datetime", "timestamp", "time", "year"]);
function quoteLiteral(value) {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}
function normalizeType(value) {
    if (typeof value === "string") {
        return value.toLowerCase();
    }
    if (value === null || value === undefined) {
        return "unknown";
    }
    return String(value).toLowerCase();
}
function normalizeNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function normalizeBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "y"].includes(normalized)) {
            return true;
        }
        if (["0", "false", "no", "n"].includes(normalized)) {
            return false;
        }
    }
    return undefined;
}
function readField(row, candidates) {
    for (const candidate of candidates) {
        if (Object.hasOwn(row, candidate)) {
            return row[candidate];
        }
    }
    const lowerMap = new Map();
    for (const [key, value] of Object.entries(row)) {
        lowerMap.set(key.toLowerCase(), value);
    }
    for (const candidate of candidates) {
        const match = lowerMap.get(candidate.toLowerCase());
        if (match !== undefined) {
            return match;
        }
    }
    return undefined;
}
function rowsToObjects(result) {
    const rawRows = result.rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
        return [];
    }
    const firstRow = rawRows[0];
    if (!Array.isArray(firstRow) && firstRow !== null && typeof firstRow === "object") {
        return rawRows;
    }
    if (Array.isArray(firstRow) && Array.isArray(result.fields)) {
        return rawRows.map((row) => {
            const mapped = {};
            result.fields?.forEach((field, index) => {
                mapped[field.name] = row[index];
            });
            return mapped;
        });
    }
    return [];
}
function mapTableType(value) {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";
    if (normalized === "base table" || normalized === "table") {
        return "table";
    }
    if (normalized === "view") {
        return "view";
    }
    return undefined;
}
function buildEngineHints(columns, indexes, primaryKey) {
    const indexedColumns = new Set();
    for (const index of indexes) {
        for (const column of index.columns) {
            indexedColumns.add(column);
        }
    }
    for (const column of primaryKey ?? []) {
        indexedColumns.add(column);
    }
    const likelyTimeColumns = columns
        .filter((column) => {
        const byType = TIME_DATA_TYPES.has(column.dataType.toLowerCase());
        const byName = TIME_COLUMN_PATTERNS.some((pattern) => pattern.test(column.name));
        return byType || byName;
    })
        .map((column) => column.name);
    const likelyFilterColumns = columns
        .filter((column) => indexedColumns.has(column.name))
        .map((column) => column.name);
    const sensitiveColumns = columns
        .filter((column) => SENSITIVE_PATTERNS.some((pattern) => pattern.test(column.name)))
        .map((column) => column.name);
    return {
        likelyTimeColumns,
        likelyFilterColumns,
        sensitiveColumns,
    };
}
export class MySqlSchemaAdapter {
    connectionPool;
    schemaCache;
    constructor(options) {
        this.connectionPool = options.connectionPool;
        this.schemaCache = options.schemaCache;
    }
    async listDatabases(ctx) {
        const sql = `
      SELECT SCHEMA_NAME AS schema_name
      FROM information_schema.SCHEMATA
      ORDER BY SCHEMA_NAME
    `;
        const rows = await this.queryObjects(ctx, sql);
        return rows.map((row) => ({
            name: String(readField(row, ["schema_name", "SCHEMA_NAME"])),
        }));
    }
    async listTables(ctx, database) {
        const sql = `
      SELECT TABLE_NAME AS table_name,
             TABLE_TYPE AS table_type,
             TABLE_COMMENT AS table_comment,
             TABLE_ROWS AS table_rows
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ${quoteLiteral(database)}
      ORDER BY TABLE_NAME
    `;
        const rows = await this.queryObjects(ctx, sql);
        return rows.map((row) => ({
            database,
            name: String(readField(row, ["table_name", "TABLE_NAME"])),
            type: mapTableType(readField(row, ["table_type", "TABLE_TYPE"])),
            comment: readField(row, ["table_comment", "TABLE_COMMENT"]) || undefined,
            rowCountEstimate: normalizeNumber(readField(row, ["table_rows", "TABLE_ROWS"])),
        }));
    }
    async describeTable(ctx, database, table) {
        const cacheKey = {
            datasource: ctx.datasource,
            database,
            table,
        };
        const cached = this.schemaCache?.get(cacheKey);
        if (cached) {
            return cached;
        }
        const columnsSql = `
      SELECT COLUMN_NAME AS column_name,
             DATA_TYPE AS data_type,
             IS_NULLABLE AS is_nullable,
             COLUMN_DEFAULT AS column_default,
             COLUMN_KEY AS column_key,
             EXTRA AS extra,
             COLUMN_COMMENT AS column_comment,
             CHARACTER_MAXIMUM_LENGTH AS character_maximum_length
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ${quoteLiteral(database)}
        AND TABLE_NAME = ${quoteLiteral(table)}
      ORDER BY ORDINAL_POSITION
    `;
        const indexesSql = `
      SELECT INDEX_NAME AS index_name,
             COLUMN_NAME AS column_name,
             NON_UNIQUE AS non_unique,
             SEQ_IN_INDEX AS seq_in_index,
             INDEX_TYPE AS index_type
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ${quoteLiteral(database)}
        AND TABLE_NAME = ${quoteLiteral(table)}
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `;
        const tableMetaSql = `
      SELECT TABLE_ROWS AS table_rows,
             TABLE_COMMENT AS table_comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ${quoteLiteral(database)}
        AND TABLE_NAME = ${quoteLiteral(table)}
      LIMIT 1
    `;
        const [columnRows, indexRows, tableMetaRows] = await Promise.all([
            this.queryObjects(ctx, columnsSql),
            this.queryObjects(ctx, indexesSql),
            this.queryObjects(ctx, tableMetaSql),
        ]);
        const indexes = this.mapIndexes(indexRows);
        const primaryKey = indexes.find((index) => index.name === "PRIMARY")?.columns;
        const indexedColumnSet = new Set(indexes.flatMap((index) => index.columns));
        const columns = columnRows.map((row) => {
            const name = String(readField(row, ["column_name", "COLUMN_NAME"]));
            const dataType = normalizeType(readField(row, ["data_type", "DATA_TYPE"]));
            const nullable = normalizeBoolean(readField(row, ["is_nullable", "IS_NULLABLE"])) ?? true;
            return {
                name,
                dataType,
                nullable,
                defaultValue: readField(row, ["column_default", "COLUMN_DEFAULT"]),
                maxLength: normalizeNumber(readField(row, ["character_maximum_length", "CHARACTER_MAXIMUM_LENGTH"])),
                isPrimaryKey: readField(row, ["column_key", "COLUMN_KEY"])?.toUpperCase() === "PRI",
                isIndexed: indexedColumnSet.has(name),
                comment: readField(row, ["column_comment", "COLUMN_COMMENT"]) || undefined,
            };
        });
        const meta = tableMetaRows[0];
        const rowCountEstimate = meta
            ? normalizeNumber(readField(meta, ["table_rows", "TABLE_ROWS"]))
            : undefined;
        const comment = meta
            ? (readField(meta, ["table_comment", "TABLE_COMMENT"]) || undefined)
            : undefined;
        const schema = {
            database,
            table,
            columns,
            indexes,
            primaryKey,
            engineHints: buildEngineHints(columns, indexes, primaryKey),
            comment,
            rowCountEstimate,
        };
        this.schemaCache?.set(cacheKey, schema);
        return schema;
    }
    mapIndexes(rows) {
        const byName = new Map();
        for (const row of rows) {
            const name = String(readField(row, ["index_name", "INDEX_NAME"]));
            const columnName = String(readField(row, ["column_name", "COLUMN_NAME"]));
            const nonUnique = normalizeNumber(readField(row, ["non_unique", "NON_UNIQUE"])) ?? 1;
            const indexType = readField(row, ["index_type", "INDEX_TYPE"]);
            const seqInIndex = normalizeNumber(readField(row, ["seq_in_index", "SEQ_IN_INDEX"])) ?? 0;
            const current = byName.get(name) ?? {
                name,
                columns: [],
                unique: nonUnique === 0,
                type: typeof indexType === "string" ? indexType : undefined,
            };
            if (seqInIndex > current.columns.length) {
                current.columns[seqInIndex - 1] = columnName;
            }
            else {
                current.columns.push(columnName);
            }
            byName.set(name, current);
        }
        return [...byName.values()].map((index) => ({
            ...index,
            columns: index.columns.filter((column) => typeof column === "string"),
        }));
    }
    async queryObjects(ctx, sql) {
        const session = await this.connectionPool.acquire(ctx.datasource, "ro");
        try {
            const result = await session.execute(sql, { timeoutMs: ctx.limits.timeoutMs });
            return rowsToObjects(result);
        }
        finally {
            await this.connectionPool.release(session);
        }
    }
}
export function createMySqlSchemaAdapter(options) {
    return new MySqlSchemaAdapter(options);
}
