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

function formatTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid flashback timestamp.");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function resolveFlashbackTimestamp(
  asOf: FlashbackInput["asOf"],
  now: () => number = Date.now,
): string {
  if ("timestamp" in asOf && typeof asOf.timestamp === "string") {
    return formatTimestamp(new Date(asOf.timestamp));
  }

  if ("relative" in asOf && typeof asOf.relative === "string") {
    const input = asOf.relative.trim();
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
        `Invalid flashback relative time: "${asOf.relative}". Expected values like 5m, 10min, 1h, or 2h30m.`,
      );
    }

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
