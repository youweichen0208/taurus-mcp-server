import { createSqlParser } from "./parser/index.js";
import { classifySql } from "./sql-classifier.js";
import { validateCost, validateSchemaAware, validateStaticRules, validateToolScope, } from "./sql-validator.js";
function dedupeCaseInsensitive(values) {
    const output = [];
    const seen = new Set();
    for (const raw of values) {
        const value = raw.trim();
        if (!value) {
            continue;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        output.push(value);
    }
    return output;
}
function pickHigherRisk(a, b) {
    const order = {
        low: 0,
        medium: 1,
        high: 2,
        blocked: 3,
    };
    return order[b] > order[a] ? b : a;
}
function pickDominantAction(current, next) {
    if (current === "block" || next === "block") {
        return "block";
    }
    if (current === "confirm" || next === "confirm") {
        return "confirm";
    }
    return "allow";
}
function parseTableRef(tableRef, defaultDatabase) {
    const trimmed = tableRef.trim();
    if (!trimmed) {
        return undefined;
    }
    const dotIndex = trimmed.indexOf(".");
    if (dotIndex <= 0) {
        return {
            database: defaultDatabase,
            table: trimmed,
        };
    }
    return {
        database: trimmed.slice(0, dotIndex),
        table: trimmed.slice(dotIndex + 1),
    };
}
function shouldExplain(cls, validations) {
    const hasBlock = validations.some((result) => result.action === "block");
    if (hasBlock) {
        return false;
    }
    if (cls.statementType === "update" || cls.statementType === "delete" || cls.statementType === "alter") {
        return true;
    }
    if (cls.statementType === "select") {
        if (!cls.hasLimit || cls.hasJoin || cls.hasSubquery || cls.hasOrderBy || cls.hasAggregate) {
            return true;
        }
    }
    return false;
}
function buildBaseDecision(input, normalizedSql, sqlHash, action, riskLevel, reasonCodes, riskHints, requiresExplain) {
    const readonlyByTool = input.toolName === "execute_readonly_sql" || input.toolName === "explain_sql";
    const readonly = input.context.limits.readonly || readonlyByTool;
    return {
        action,
        riskLevel,
        reasonCodes: dedupeCaseInsensitive(reasonCodes),
        riskHints: dedupeCaseInsensitive(riskHints),
        normalizedSql,
        sqlHash,
        requiresExplain,
        requiresConfirmation: action === "confirm",
        runtimeLimits: {
            readonly,
            timeoutMs: input.context.limits.timeoutMs,
            maxRows: input.context.limits.maxRows,
            maxColumns: input.context.limits.maxColumns,
            maxFieldChars: input.context.limits.maxFieldChars ?? 2048,
        },
    };
}
function mergeDecision(input, normalizedSql, sqlHash, validations, requiresExplain) {
    let action = "allow";
    let riskLevel = "low";
    const reasonCodes = [];
    const riskHints = [];
    for (const validation of validations) {
        action = pickDominantAction(action, validation.action);
        riskLevel = pickHigherRisk(riskLevel, validation.riskLevel);
        reasonCodes.push(...validation.reasonCodes);
        riskHints.push(...validation.riskHints);
    }
    return buildBaseDecision(input, normalizedSql, sqlHash, action, riskLevel, reasonCodes, riskHints, requiresExplain);
}
async function loadSchemaSnapshot(introspector, ctx, tableRefs) {
    const snapshot = new Map();
    if (!introspector || tableRefs.length === 0) {
        return snapshot;
    }
    const parsed = dedupeCaseInsensitive(tableRefs)
        .map((tableRef) => parseTableRef(tableRef, ctx.database))
        .filter((entry) => entry !== undefined && !!entry.table);
    await Promise.all(parsed.map(async (tableRef) => {
        if (!tableRef.database) {
            return;
        }
        try {
            const schema = await introspector.describeTable(ctx, tableRef.database, tableRef.table);
            snapshot.set(`${schema.database}.${schema.table}`.toLowerCase(), schema);
        }
        catch {
            // Ignore per-table load failures; validator will report missing table/column from snapshot.
        }
    }));
    return snapshot;
}
export class GuardrailImpl {
    schemaIntrospector;
    executor;
    parserFactory;
    constructor(options = {}) {
        this.schemaIntrospector = options.schemaIntrospector;
        this.executor = options.executor;
        this.parserFactory = options.parserFactory ?? ((engine) => createSqlParser(engine));
    }
    async inspect(input) {
        const parser = this.parserFactory(input.context.engine);
        const normalized = parser.normalize(input.sql);
        const parseResult = parser.parse(normalized.normalizedSql);
        if (!parseResult.ok) {
            return buildBaseDecision(input, normalized.normalizedSql, normalized.sqlHash, "block", "blocked", ["G001"], [`SQL parse failed: ${parseResult.error.message}`], false);
        }
        const cls = classifySql(parseResult.ast, normalized, input.context.engine);
        const d1 = validateToolScope(input.toolName, cls);
        if (d1.action === "block") {
            return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1], false);
        }
        const d2 = validateStaticRules(cls);
        if (d2.action === "block") {
            return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1, d2], false);
        }
        const schemaSnapshot = await loadSchemaSnapshot(this.schemaIntrospector, input.context, cls.referencedTables);
        const d3 = validateSchemaAware(cls, schemaSnapshot);
        if (d3.action === "block") {
            return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1, d2, d3], false);
        }
        const preCostValidations = [d1, d2, d3];
        const requiresExplain = shouldExplain(cls, preCostValidations);
        let d4;
        if (requiresExplain && this.executor) {
            const explainSummary = await this.executor.explainForGuardrail(input.sql, input.context);
            d4 = validateCost(cls, explainSummary);
        }
        else if (requiresExplain && !this.executor) {
            d4 = {
                action: "confirm",
                riskLevel: "high",
                reasonCodes: ["G002"],
                riskHints: [
                    "Explain summary is required but executor is unavailable.",
                    "Fallback to confirmation before execution.",
                ],
            };
        }
        const validations = d4 ? [...preCostValidations, d4] : preCostValidations;
        return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, validations, requiresExplain);
    }
}
export function createGuardrail(options = {}) {
    return new GuardrailImpl(options);
}
