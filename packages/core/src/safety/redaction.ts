import { createHash } from "node:crypto";

export type SensitiveStrategy = "mask" | "drop" | "hash";

export interface RedactionColumn {
  name: string;
  type?: string;
}

export interface RawQueryResult {
  columns: RedactionColumn[];
  rows: unknown[][];
  rowCount: number;
}

export interface RedactionPolicy {
  maxRows: number;
  maxColumns: number;
  maxFieldChars: number;
  sensitiveColumns?: Iterable<string>;
  sensitiveStrategy?: SensitiveStrategy;
}

export interface RedactedQueryResult {
  columns: RedactionColumn[];
  rows: unknown[][];
  rowCount: number;
  originalRowCount: number;
  truncated: boolean;
  rowTruncated: boolean;
  columnTruncated: boolean;
  fieldTruncated: boolean;
  redactedColumns: string[];
  droppedColumns: string[];
  truncatedColumns: string[];
}

export interface ResultRedactor {
  redact(raw: RawQueryResult, policy: RedactionPolicy): RedactedQueryResult;
}

const DEFAULT_MAX_ROWS = 200;
const DEFAULT_MAX_COLUMNS = 50;
const DEFAULT_MAX_FIELD_CHARS = 2048;
const DEFAULT_SENSITIVE_STRATEGY: SensitiveStrategy = "mask";

const SENSITIVE_COLUMN_PATTERNS = [
  /password|passwd|secret/i,
  /token|api_?key|access_?key|refresh_?token/i,
  /phone|mobile|tel/i,
  /email/i,
  /id_?card|passport|ssn/i,
  /bank|card_?no|account/i,
];

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizeColumnName(name: string): string {
  return name.trim().replace(/^[`'"]+|[`'"]+$/g, "").toLowerCase();
}

function columnCandidates(name: string): string[] {
  const normalized = normalizeColumnName(name);
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex < 0) {
    return [normalized];
  }
  return [normalized, normalized.slice(dotIndex + 1)];
}

function buildSensitiveSet(input: Iterable<string> | undefined): Set<string> {
  const set = new Set<string>();
  if (!input) {
    return set;
  }
  for (const value of input) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeColumnName(value);
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
}

function isSensitiveColumn(name: string, explicitSensitive: Set<string>): boolean {
  const candidates = columnCandidates(name);
  if (candidates.some((candidate) => explicitSensitive.has(candidate))) {
    return true;
  }
  const base = candidates[candidates.length - 1];
  return SENSITIVE_COLUMN_PATTERNS.some((pattern) => pattern.test(base));
}

function maskValue(columnName: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const baseName = columnCandidates(columnName).at(-1) ?? "";
  const text = typeof value === "string" ? value : String(value);

  if (/phone|mobile|tel/i.test(baseName)) {
    return text.replace(/(\d{3})\d+(\d{4})/, "$1****$2");
  }
  if (/email/i.test(baseName)) {
    return text.replace(/(.{2}).*(@.*)/, "$1***$2");
  }
  if (/id_?card|passport|ssn/i.test(baseName)) {
    if (text.length <= 10) {
      return "***";
    }
    return `${text.slice(0, 6)}********${text.slice(-4)}`;
  }
  return "***";
}

function hashValue(value: unknown): string {
  const plain =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : JSON.stringify(value);
  const digest = createHash("sha256").update(plain).digest("hex").slice(0, 12);
  return `[HASH:${digest}]`;
}

function truncateFieldValue(
  value: unknown,
  maxFieldChars: number,
): { value: unknown; truncated: boolean } {
  if (typeof value !== "string") {
    return { value, truncated: false };
  }
  if (value.length <= maxFieldChars) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, maxFieldChars)}...[TRUNCATED]`,
    truncated: true,
  };
}

class DefaultResultRedactor implements ResultRedactor {
  redact(raw: RawQueryResult, policy: RedactionPolicy): RedactedQueryResult {
    const maxRows = asPositiveInt(policy.maxRows, DEFAULT_MAX_ROWS);
    const maxColumns = asPositiveInt(policy.maxColumns, DEFAULT_MAX_COLUMNS);
    const maxFieldChars = asPositiveInt(policy.maxFieldChars, DEFAULT_MAX_FIELD_CHARS);
    const sensitiveStrategy = policy.sensitiveStrategy ?? DEFAULT_SENSITIVE_STRATEGY;
    const explicitSensitive = buildSensitiveSet(policy.sensitiveColumns);

    const sourceColumns = Array.isArray(raw.columns) ? raw.columns : [];
    const sourceRows = Array.isArray(raw.rows) ? raw.rows : [];
    const originalRowCount = asNonNegativeInt(raw.rowCount, sourceRows.length);

    const rowTruncated = sourceRows.length > maxRows || originalRowCount > maxRows;
    const columnTruncated = sourceColumns.length > maxColumns;
    const rowLimited = sourceRows.slice(0, maxRows);
    const columnLimited = sourceColumns.slice(0, maxColumns);

    const keepColumnIndexes: number[] = [];
    const keepColumns: RedactionColumn[] = [];
    const keepColumnSensitiveFlags: boolean[] = [];
    const redactedColumns = new Set<string>();
    const droppedColumns: string[] = [];

    for (let index = 0; index < columnLimited.length; index += 1) {
      const column = columnLimited[index];
      const sensitive = isSensitiveColumn(column.name, explicitSensitive);

      if (sensitive && sensitiveStrategy === "drop") {
        droppedColumns.push(column.name);
        continue;
      }

      keepColumnIndexes.push(index);
      keepColumns.push(column);
      keepColumnSensitiveFlags.push(sensitive);
      if (sensitive) {
        redactedColumns.add(column.name);
      }
    }

    const truncatedColumns = new Set<string>();
    const outputRows = rowLimited.map((row) => {
      const sourceRow = Array.isArray(row) ? row : [row];
      const outputRow: unknown[] = [];

      for (let outputIndex = 0; outputIndex < keepColumns.length; outputIndex += 1) {
        const sourceIndex = keepColumnIndexes[outputIndex];
        const column = keepColumns[outputIndex];
        const isSensitive = keepColumnSensitiveFlags[outputIndex];
        const rawValue = sourceRow[sourceIndex];

        let value: unknown;
        if (isSensitive) {
          if (sensitiveStrategy === "hash") {
            value = hashValue(rawValue);
          } else {
            value = maskValue(column.name, rawValue);
          }
        } else {
          const truncated = truncateFieldValue(rawValue, maxFieldChars);
          value = truncated.value;
          if (truncated.truncated) {
            truncatedColumns.add(column.name);
          }
        }

        outputRow.push(value);
      }

      return outputRow;
    });

    const fieldTruncated = truncatedColumns.size > 0;

    return {
      columns: keepColumns,
      rows: outputRows,
      rowCount: originalRowCount,
      originalRowCount,
      truncated: rowTruncated || columnTruncated || fieldTruncated,
      rowTruncated,
      columnTruncated,
      fieldTruncated,
      redactedColumns: keepColumns
        .map((column) => column.name)
        .filter((name) => redactedColumns.has(name)),
      droppedColumns,
      truncatedColumns: keepColumns
        .map((column) => column.name)
        .filter((name) => truncatedColumns.has(name)),
    };
  }
}

export function createResultRedactor(): ResultRedactor {
  return new DefaultResultRedactor();
}
