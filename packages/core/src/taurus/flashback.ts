import type { ReadonlyOptions } from "../executor/sql-executor.js";

export interface FlashbackInput {
  database?: string;
  table: string;
  asOf:
    | { timestamp: string; relative?: never }
    | { timestamp?: never; relative: string };
  where?: string;
  columns?: string[];
  limit?: number;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const SQL_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?$/;
const RELATIVE_DURATION_PATTERN =
  /(\d+)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)/gi;

type DurationUnit = "ms" | "s" | "m" | "h" | "d";

const UNIT_TO_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function normalizeDurationUnit(unit: string): DurationUnit {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("ms")) {
    return "ms";
  }
  if (normalized.startsWith("s")) {
    return "s";
  }
  if (normalized.startsWith("m")) {
    return "m";
  }
  if (normalized.startsWith("h")) {
    return "h";
  }
  return "d";
}

function quoteIdentifier(identifier: string, fieldName: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid ${fieldName}: "${identifier}".`);
  }
  return `\`${identifier}\``;
}

export type FlashbackNoViewDetails = {
  database?: string;
  table?: string;
  where?: string;
  requested_timestamp: string;
  current_time?: string;
  backquery_window_seconds?: number;
  earliest_supported_timestamp_estimate?: string;
  current_row_updated_at?: string;
  recommended_timestamps?: string[];
  guidance?: string[];
};

export class FlashbackNoViewError extends Error {
  readonly details: FlashbackNoViewDetails;

  constructor(message: string, details: FlashbackNoViewDetails) {
    super(message);
    this.name = "FlashbackNoViewError";
    this.details = details;
  }
}

export function formatTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid flashback timestamp.");
  }

  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseTimestampLiteral(timestamp: string): string | undefined {
  const match = timestamp.trim().match(SQL_TIMESTAMP_PATTERN);
  if (!match) {
    return undefined;
  }
  return `${match[1]} ${match[2]}`;
}

function parseRelativeDurationMs(relative: string): number {
  const input = relative.trim();
  if (!input) {
    throw new Error("Flashback relative time cannot be empty.");
  }

  let consumed = "";
  let offsetMs = 0;
  for (const match of input.matchAll(RELATIVE_DURATION_PATTERN)) {
    consumed += match[0];
    const amount = Number.parseInt(match[1], 10);
    const unit = normalizeDurationUnit(match[2]);
    offsetMs += amount * UNIT_TO_MS[unit];
  }

  if (offsetMs <= 0 || consumed.replace(/\s+/g, "") !== input.replace(/\s+/g, "")) {
    throw new Error(
      `Invalid flashback relative time: "${relative}". Expected values like 5m, 10min, 1h, or 2h30m.`,
    );
  }

  return offsetMs;
}

function parseTimestampLiteralToDate(timestamp: string): Date {
  const literal = parseTimestampLiteral(timestamp);
  if (literal) {
    const match = literal.match(SQL_TIMESTAMP_PATTERN);
    if (!match) {
      throw new Error("Invalid flashback timestamp.");
    }
    const [, datePart, timePart] = match;
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes, seconds] = timePart.split(":").map(Number);
    const date = new Date(year, month - 1, day, hours, minutes, seconds, 0);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid flashback timestamp.");
    }
    return date;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid flashback timestamp.");
  }
  return parsed;
}

export function resolveRelativeTimestampFromBase(
  relative: string,
  baseTimestamp: string,
): string {
  const offsetMs = parseRelativeDurationMs(relative);
  const baseDate = parseTimestampLiteralToDate(baseTimestamp);
  return formatTimestamp(new Date(baseDate.getTime() - offsetMs));
}

export function resolveFlashbackTimestamp(
  asOf: FlashbackInput["asOf"],
  now: () => number = Date.now,
): string {
  if ("timestamp" in asOf && typeof asOf.timestamp === "string") {
    const literal = parseTimestampLiteral(asOf.timestamp);
    if (literal) {
      return literal;
    }
    return formatTimestamp(new Date(asOf.timestamp));
  }

  if ("relative" in asOf && typeof asOf.relative === "string") {
    const offsetMs = parseRelativeDurationMs(asOf.relative);
    return formatTimestamp(new Date(now() - offsetMs));
  }

  throw new Error("Flashback query requires either as_of.timestamp or as_of.relative.");
}

export function buildFlashbackSql(
  input: FlashbackInput,
  defaultDatabase: string,
  now: () => number = Date.now,
): string {
  const database = quoteIdentifier(input.database ?? defaultDatabase, "database");
  const table = quoteIdentifier(input.table, "table");
  const columns =
    input.columns && input.columns.length > 0
      ? input.columns.map((column) => quoteIdentifier(column, "column")).join(", ")
      : "*";
  const timestamp = resolveFlashbackTimestamp(input.asOf, now);
  const clauses = [
    `SELECT ${columns}`,
    `FROM ${database}.${table} AS OF TIMESTAMP '${timestamp}'`,
  ];

  const whereClause = input.where?.trim();
  if (whereClause) {
    clauses.push(`WHERE (${whereClause})`);
  }

  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new Error("Flashback query limit must be a positive integer.");
    }
    clauses.push(`LIMIT ${input.limit}`);
  }

  return clauses.join(" ");
}

export function flashbackReadonlyOptions(limit: number | undefined): ReadonlyOptions | undefined {
  if (limit === undefined) {
    return undefined;
  }
  return {
    maxRows: limit,
  };
}
