function asFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readObjectField(row, candidates) {
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
        const value = lowerMap.get(candidate.toLowerCase());
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}
export function normalizeExplainRows(result) {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (rows.length === 0) {
        return [];
    }
    const first = rows[0];
    if (isObject(first)) {
        return rows.filter((row) => isObject(row));
    }
    if (Array.isArray(first) && Array.isArray(result.fields) && result.fields.length > 0) {
        return rows
            .filter((row) => Array.isArray(row))
            .map((row) => {
            const mapped = {};
            result.fields?.forEach((field, index) => {
                mapped[field.name] = row[index];
            });
            return mapped;
        });
    }
    return [];
}
export function summarizeExplainRows(rows) {
    const fullTableScanLikely = rows.some((row) => {
        const scanType = readObjectField(row, ["type", "access_type"]);
        return typeof scanType === "string" && scanType.toUpperCase() === "ALL";
    });
    const indexHitLikely = rows.length > 0 &&
        rows.every((row) => {
            const key = readObjectField(row, ["key", "possible_key", "index_name"]);
            if (key === null || key === undefined) {
                return false;
            }
            return String(key).trim().length > 0;
        });
    const estimatedRows = rows.reduce((sum, row) => {
        const numeric = asFiniteNumber(readObjectField(row, ["rows", "estimated_rows"]));
        return numeric !== undefined ? sum + numeric : sum;
    }, 0);
    const usesTempStructure = rows.some((row) => {
        const extra = readObjectField(row, ["Extra", "extra", "note"]);
        return typeof extra === "string" && /using temporary/i.test(extra);
    });
    const usesFilesort = rows.some((row) => {
        const extra = readObjectField(row, ["Extra", "extra", "note"]);
        return typeof extra === "string" && /using filesort/i.test(extra);
    });
    const riskHints = [];
    if (fullTableScanLikely) {
        riskHints.push("Explain suggests potential full table scan.");
    }
    if (!indexHitLikely && rows.length > 0) {
        riskHints.push("Explain suggests low index hit probability.");
    }
    if (usesTempStructure) {
        riskHints.push("Explain contains Using temporary.");
    }
    if (usesFilesort) {
        riskHints.push("Explain contains Using filesort.");
    }
    return {
        fullTableScanLikely,
        indexHitLikely,
        estimatedRows: rows.length > 0 ? estimatedRows : null,
        usesTempStructure,
        usesFilesort,
        riskHints,
    };
}
export function buildExplainRecommendations(summary) {
    const recommendations = [];
    if (summary.fullTableScanLikely) {
        recommendations.push("Consider adding WHERE filters and an index to avoid full table scans.");
    }
    if (!summary.indexHitLikely) {
        recommendations.push("Review indexes for filter and join columns.");
    }
    if (summary.estimatedRows !== null && summary.estimatedRows > 100_000) {
        recommendations.push("Estimated row count is high; consider narrowing predicates or adding selective indexes.");
    }
    if (summary.usesTempStructure) {
        recommendations.push("Avoid large temporary structures by reducing sort/group cardinality.");
    }
    if (summary.usesFilesort) {
        recommendations.push("Consider index support for ORDER BY to reduce filesort.");
    }
    return recommendations;
}
