import type { RawResult } from "./connection-pool.js";
import type { ExplainRiskSummary } from "../safety/sql-validator.js";
export declare function normalizeExplainRows(result: RawResult): Record<string, unknown>[];
export declare function summarizeExplainRows(rows: Record<string, unknown>[]): ExplainRiskSummary;
export declare function buildExplainRecommendations(summary: ExplainRiskSummary): string[];
