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
const READONLY_SIDE_EFFECT_PATTERN =
  /\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|GET_LOCK\s*\(|RELEASE_LOCK\s*\(|SLEEP\s*\(|BENCHMARK\s*\(|LOAD_FILE\s*\()/i;

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

function containsSelectStar(cls: SqlClassification): boolean {
  if (cls.statementType !== "select") {
    return false;
  }
  return cls.referencedColumns.some((column) => STAR_COLUMN_PATTERN.test(column.trim()));
}

export function validateToolScope(toolName: string, cls: SqlClassification): ValidationResult {
  if (toolName === "execute_readonly_sql") {
    if (!READONLY_STATEMENTS.has(cls.statementType)) {
      return block(
        ["T001"],
        [
          `Tool execute_readonly_sql only allows SELECT/SHOW/EXPLAIN/DESCRIBE, got ${cls.statementType}.`,
          "Use analyze_mutation_sql to generate non-executing SQL Advice.",
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

export function validateDatabaseScope(
  cls: SqlClassification,
  database: string | undefined,
): ValidationResult {
  const schemas = cls.referencedSchemas ?? [];
  if (schemas.length === 0) {
    return allow("low");
  }
  if (!database) {
    return block(
      ["D001"],
      ["SQL uses an explicit database but the session has no bound database."],
    );
  }

  const expected = database.toLowerCase();
  const outOfScope = schemas.filter((schema) => schema.toLowerCase() !== expected);
  if (outOfScope.length > 0) {
    return block(
      ["D002"],
      [
        `SQL references database(s) outside the bound database "${database}": ${outOfScope.join(", ")}.`,
      ],
    );
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

  if (cls.statementType === "insert") {
    escalateToConfirm("R006", "INSERT, REPLACE, and UPSERT statements require confirmation.");
  }

  if (cls.statementType === "select") {
    if (READONLY_SIDE_EFFECT_PATTERN.test(cls.normalizedSql)) {
      escalateToBlock("R009", "SELECT statements with side effects or blocking functions are blocked.");
    }
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
