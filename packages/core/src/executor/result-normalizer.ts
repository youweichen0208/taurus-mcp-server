import type { RawResult } from "./connection-pool.js";
import type { ColumnMeta } from "./types.js";

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function inferColumns(raw: RawResult, rows: unknown[]): ColumnMeta[] {
  if (Array.isArray(raw.fields) && raw.fields.length > 0) {
    return raw.fields.map((field) => ({
      name: field.name,
      type: field.type,
    }));
  }

  const first = rows[0];
  if (isObject(first)) {
    return Object.keys(first).map((name) => ({ name }));
  }
  if (Array.isArray(first)) {
    return first.map((_, index) => ({ name: `col_${index + 1}` }));
  }
  return [];
}

export function normalizeRows(rows: unknown[], columns: ColumnMeta[]): unknown[][] {
  if (rows.length === 0) {
    return [];
  }
  const first = rows[0];
  if (Array.isArray(first)) {
    return rows.map((row) => (Array.isArray(row) ? row : [row]));
  }
  if (isObject(first)) {
    return rows.map((row) => {
      if (!isObject(row)) {
        return [row];
      }
      return columns.map((column) => row[column.name]);
    });
  }
  return rows.map((row) => [row]);
}
