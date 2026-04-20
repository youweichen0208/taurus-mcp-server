import type { TableSchema } from "../schema/introspector.js";
import type { SqlClassification } from "./sql-classifier.js";
export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type ValidationAction = "allow" | "confirm" | "block";
export interface ValidationResult {
    action: ValidationAction;
    riskLevel: RiskLevel;
    reasonCodes: string[];
    riskHints: string[];
}
export interface ExplainRiskSummary {
    fullTableScanLikely: boolean;
    indexHitLikely: boolean;
    estimatedRows: number | null;
    usesTempStructure: boolean;
    usesFilesort: boolean;
    riskHints: string[];
}
export declare function validateToolScope(toolName: string, cls: SqlClassification): ValidationResult;
export declare function validateStaticRules(cls: SqlClassification): ValidationResult;
export declare function validateSchemaAware(cls: SqlClassification, schemaSnapshot: Map<string, TableSchema>): ValidationResult;
export declare function validateCost(cls: SqlClassification, explainSummary: ExplainRiskSummary): ValidationResult;
