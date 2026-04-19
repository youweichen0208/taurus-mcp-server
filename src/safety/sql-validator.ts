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

const READONLY_STATEMENTS = new Set(["select", "show", "explain", "describe"]);
const MUTATION_STATEMENTS = new Set(["insert", "update", "delete"]);
const STAR_COLUMN_PATTERN = /(^|\.)(\*|\(\.\*\))$/;
const COST_CONFIRM_ROWS_THRESHOLD = 100_000;
const COST_HIGH_ROWS_THRESHOLD = 1_000_000;

function allow(riskLevel: Extract<RiskLevel, "low" | "medium"> = "low"): ValidationResult {
  return {
    action: "allow",
    riskLevel,
    reasonCodes: [],
    riskHints: [],
  };
}

function confirm(
  riskLevel: Extract<RiskLevel, "medium" | "high"> = "high",
  reasonCodes: string[],
  riskHints: string[],
): ValidationResult {
  return {
    action: "confirm",
    riskLevel,
    reasonCodes: dedupeCaseInsensitive(reasonCodes),
    riskHints: dedupeCaseInsensitive(riskHints),
  };
}

function block(reasonCodes: string[], riskHints: string[]): ValidationResult {
  return {
    action: "block",
    riskLevel: "blocked",
    reasonCodes: dedupeCaseInsensitive(reasonCodes),
    riskHints: dedupeCaseInsensitive(riskHints),
  };
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
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

function asNormalizedTableName(schema: TableSchema): string {
  return `${schema.database}.${schema.table}`.toLowerCase();
}

function matchesTableRef(schema: TableSchema, tableRef: string): boolean {
  const ref = tableRef.toLowerCase();
  const dotIndex = ref.indexOf(".");
  if (dotIndex >= 0) {
    const db = ref.slice(0, dotIndex);
    const table = ref.slice(dotIndex + 1);
    return schema.database.toLowerCase() === db && schema.table.toLowerCase() === table;
  }
  return schema.table.toLowerCase() === ref || asNormalizedTableName(schema) === ref;
}

function resolveTableCandidates(schemaSnapshot: Map<string, TableSchema>, tableRef: string): TableSchema[] {
  const candidates = new Map<string, TableSchema>();
  for (const [key, value] of schemaSnapshot.entries()) {
    if (key.toLowerCase() === tableRef.toLowerCase() || matchesTableRef(value, tableRef)) {
      candidates.set(asNormalizedTableName(value), value);
    }
  }
  return [...candidates.values()];
}

function containsSelectStar(cls: SqlClassification): boolean {
  if (cls.statementType !== "select") {
    return false;
  }
  return cls.referencedColumns.some((column) => STAR_COLUMN_PATTERN.test(column.trim()));
}

function splitColumnRef(columnRef: string): { table?: string; column: string } {
  const trimmed = columnRef.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { column: trimmed };
  }
  return {
    table: trimmed.slice(0, dotIndex),
    column: trimmed.slice(dotIndex + 1),
  };
}

function isWildcardColumn(column: string): boolean {
  return STAR_COLUMN_PATTERN.test(column.trim());
}

function hasColumn(schema: TableSchema, columnName: string): boolean {
  return schema.columns.some((column) => column.name.toLowerCase() === columnName.toLowerCase());
}

function hasSensitiveColumn(schema: TableSchema, columnName: string): boolean {
  return (
    schema.engineHints?.sensitiveColumns.some(
      (sensitive) => sensitive.toLowerCase() === columnName.toLowerCase(),
    ) ?? false
  );
}

export function validateToolScope(toolName: string, cls: SqlClassification): ValidationResult {
  if (toolName === "execute_readonly_sql") {
    if (!READONLY_STATEMENTS.has(cls.statementType)) {
      return block(
        ["T001"],
        [
          `Tool execute_readonly_sql only allows SELECT/SHOW/EXPLAIN/DESCRIBE, got ${cls.statementType}.`,
          "Use execute_sql for controlled mutations.",
        ],
      );
    }
    return allow("low");
  }

  if (toolName === "execute_sql") {
    if (!MUTATION_STATEMENTS.has(cls.statementType)) {
      return block(
        ["T002"],
        [
          `Tool execute_sql only allows INSERT/UPDATE/DELETE, got ${cls.statementType}.`,
          "Use execute_readonly_sql for read statements.",
        ],
      );
    }
    return allow("low");
  }

  if (toolName === "explain_sql") {
    if (cls.statementType === "unknown") {
      return block(
        ["T003"],
        ["Tool explain_sql could not classify the statement type. Provide a single supported SQL statement."],
      );
    }
    return allow("low");
  }

  return allow("low");
}

export function validateStaticRules(cls: SqlClassification): ValidationResult {
  const reasonCodes: string[] = [];
  const riskHints: string[] = [];
  let hasBlock = false;
  let hasConfirm = false;
  let hasMedium = false;

  const escalateToBlock = (code: string, hint: string): void => {
    hasBlock = true;
    reasonCodes.push(code);
    riskHints.push(hint);
  };

  const escalateToConfirm = (code: string, hint: string): void => {
    hasConfirm = true;
    reasonCodes.push(code);
    riskHints.push(hint);
  };

  const escalateToMediumAllow = (code: string, hint: string): void => {
    hasMedium = true;
    reasonCodes.push(code);
    riskHints.push(hint);
  };

  if (cls.isMultiStatement) {
    escalateToBlock("R001", "Multi-statement SQL is blocked.");
  }

  if (cls.statementType === "grant" || cls.statementType === "revoke") {
    escalateToBlock("R002", "DCL statements (GRANT/REVOKE) are blocked.");
  }

  if (
    cls.statementType === "truncate" ||
    (cls.statementType === "drop" && /^DROP\s+DATABASE\b/i.test(cls.normalizedSql))
  ) {
    escalateToBlock("R003", "DROP DATABASE and TRUNCATE are blocked.");
  }

  if (cls.statementType === "set" && /^SET\s+GLOBAL\b/i.test(cls.normalizedSql)) {
    escalateToBlock("R004", "SET GLOBAL is blocked.");
  }

  if (cls.statementType === "update" || cls.statementType === "delete") {
    if (!cls.hasWhere) {
      escalateToBlock("R005", "UPDATE/DELETE without WHERE is blocked.");
    } else {
      escalateToConfirm("R006", "Mutation SQL with WHERE requires confirmation.");
    }
  }

  if (cls.statementType === "select") {
    if (!cls.hasLimit && !cls.hasAggregate) {
      escalateToMediumAllow("R007", "Detail SELECT without LIMIT has medium risk.");
    }
    if (containsSelectStar(cls)) {
      escalateToMediumAllow("R008", "SELECT * may return excessive columns.");
    }
  }

  if (hasBlock) {
    return block(reasonCodes, riskHints);
  }
  if (hasConfirm) {
    return confirm("high", reasonCodes, riskHints);
  }
  if (hasMedium) {
    return {
      action: "allow",
      riskLevel: "medium",
      reasonCodes: dedupeCaseInsensitive(reasonCodes),
      riskHints: dedupeCaseInsensitive(riskHints),
    };
  }
  return allow("low");
}

export function validateSchemaAware(
  cls: SqlClassification,
  schemaSnapshot: Map<string, TableSchema>,
): ValidationResult {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const sensitiveColumns = new Set<string>();

  const resolvedTables = new Map<string, TableSchema[]>();
  for (const tableRef of cls.referencedTables) {
    const candidates = resolveTableCandidates(schemaSnapshot, tableRef);
    resolvedTables.set(tableRef, candidates);
    if (candidates.length === 0) {
      missingTables.push(tableRef);
    }
  }

  if (missingTables.length > 0) {
    return block(
      ["R009"],
      [
        `Referenced table(s) not found: ${dedupeCaseInsensitive(missingTables).join(", ")}.`,
        "Use describe_table/list_tables to refresh schema context.",
      ],
    );
  }

  const fallbackCandidates = cls.referencedTables.length
    ? cls.referencedTables.flatMap((tableRef) => resolvedTables.get(tableRef) ?? [])
    : [...schemaSnapshot.values()];

  for (const columnRef of cls.referencedColumns) {
    const { table, column } = splitColumnRef(columnRef);
    if (!column || isWildcardColumn(column)) {
      continue;
    }

    const candidates = table
      ? resolveTableCandidates(schemaSnapshot, table)
      : fallbackCandidates;

    if (candidates.length > 0 && !candidates.some((schema) => hasColumn(schema, column))) {
      missingColumns.push(columnRef);
      continue;
    }

    if (candidates.some((schema) => hasSensitiveColumn(schema, column))) {
      sensitiveColumns.add(columnRef);
    }
  }

  if (missingColumns.length > 0) {
    return block(
      ["R010"],
      [
        `Referenced column(s) not found: ${dedupeCaseInsensitive(missingColumns).join(", ")}.`,
        "Use describe_table to verify table schema before executing SQL.",
      ],
    );
  }

  if (sensitiveColumns.size > 0) {
    return {
      action: "allow",
      riskLevel: "medium",
      reasonCodes: ["R011"],
      riskHints: [
        `Sensitive column(s) detected: ${[...sensitiveColumns].join(", ")}.`,
        "Result should apply redaction policy.",
      ],
    };
  }

  return allow("low");
}

export function validateCost(
  cls: SqlClassification,
  explainSummary: ExplainRiskSummary,
): ValidationResult {
  const reasonCodes: string[] = [];
  const riskHints: string[] = [...(explainSummary.riskHints ?? [])];
  let hasConfirm = false;
  let hasMedium = false;

  const escalateToConfirm = (code: string, hint: string): void => {
    hasConfirm = true;
    reasonCodes.push(code);
    riskHints.push(hint);
  };

  const escalateToMedium = (code: string, hint: string): void => {
    hasMedium = true;
    reasonCodes.push(code);
    riskHints.push(hint);
  };

  if (explainSummary.fullTableScanLikely) {
    const rows = explainSummary.estimatedRows ?? 0;
    if (rows >= COST_CONFIRM_ROWS_THRESHOLD) {
      escalateToConfirm("C001", "Likely full table scan with high estimated rows.");
    } else {
      escalateToMedium("C001", "Likely full table scan.");
    }
  }

  if (explainSummary.estimatedRows !== null) {
    if (explainSummary.estimatedRows >= COST_HIGH_ROWS_THRESHOLD) {
      escalateToConfirm("C002", "Estimated rows exceed high-risk threshold.");
    } else if (explainSummary.estimatedRows >= COST_CONFIRM_ROWS_THRESHOLD) {
      escalateToMedium("C002", "Estimated rows exceed medium-risk threshold.");
    }
  }

  if (explainSummary.usesTempStructure) {
    escalateToMedium("C003", "Execution plan may use temporary structures.");
  }

  if (explainSummary.usesFilesort) {
    escalateToMedium("C004", "Execution plan may use filesort.");
  }

  if (
    !explainSummary.indexHitLikely &&
    (cls.statementType === "select" || cls.statementType === "update" || cls.statementType === "delete")
  ) {
    escalateToMedium("C005", "Execution plan indicates low index hit probability.");
  }

  if (hasConfirm) {
    return confirm("high", reasonCodes, riskHints);
  }

  if (hasMedium) {
    return {
      action: "allow",
      riskLevel: "medium",
      reasonCodes: dedupeCaseInsensitive(reasonCodes),
      riskHints: dedupeCaseInsensitive(riskHints),
    };
  }

  return {
    action: "allow",
    riskLevel: "low",
    reasonCodes: dedupeCaseInsensitive(reasonCodes),
    riskHints: dedupeCaseInsensitive(riskHints),
  };
}
