export class SchemaIntrospectionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "SchemaIntrospectionError";
        this.code = code;
    }
}
function normalizeName(value, fieldName) {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new SchemaIntrospectionError("INVALID_INTROSPECTION_INPUT", `Invalid ${fieldName}: value cannot be empty.`);
    }
    return trimmed;
}
function validateSampleSize(n) {
    if (!Number.isInteger(n) || n <= 0) {
        throw new SchemaIntrospectionError("INVALID_INTROSPECTION_INPUT", `Invalid sample size: ${n}. It must be a positive integer.`);
    }
    return n;
}
export class AdapterSchemaIntrospector {
    adapters;
    constructor(options) {
        this.adapters = options.adapters;
    }
    async listDatabases(ctx) {
        return this.getAdapter(ctx.engine).listDatabases(ctx);
    }
    async listTables(ctx, database) {
        return this.getAdapter(ctx.engine).listTables(ctx, normalizeName(database, "database"));
    }
    async describeTable(ctx, database, table) {
        return this.getAdapter(ctx.engine).describeTable(ctx, normalizeName(database, "database"), normalizeName(table, "table"));
    }
    async sampleRows(ctx, database, table, n) {
        return this.getAdapter(ctx.engine).sampleRows(ctx, normalizeName(database, "database"), normalizeName(table, "table"), validateSampleSize(n));
    }
    getAdapter(engine) {
        const adapter = this.adapters[engine];
        if (!adapter) {
            throw new SchemaIntrospectionError("SCHEMA_ADAPTER_NOT_FOUND", `Schema adapter not found for engine "${engine}".`);
        }
        return adapter;
    }
}
export function createSchemaIntrospector(options) {
    return new AdapterSchemaIntrospector(options);
}
