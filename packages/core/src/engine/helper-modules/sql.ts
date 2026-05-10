import type { FindTopSlowSqlInput } from "../../diagnostics/types.js";
import type { ExplainResult } from "../../executor/sql-executor.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import type { StatementDigestRow } from "./types.js";

export function withDatasourceSummary(prefix: string, datasource: string): string {
  return `${prefix} on datasource ${datasource}.`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export function escapeLikePrefix(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

export function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

export function topSlowSqlOrderBy(sortBy: FindTopSlowSqlInput["sortBy"]): string {
  switch (sortBy) {
    case "avg_latency":
      return "AVG_TIMER_WAIT DESC, SUM_TIMER_WAIT DESC, COUNT_STAR DESC";
    case "exec_count":
      return "COUNT_STAR DESC, SUM_TIMER_WAIT DESC, AVG_TIMER_WAIT DESC";
    case "lock_time":
      return "SUM_LOCK_TIME DESC, SUM_TIMER_WAIT DESC, COUNT_STAR DESC";
    case "total_latency":
    default:
      return "SUM_TIMER_WAIT DESC, AVG_TIMER_WAIT DESC, COUNT_STAR DESC";
  }
}

export function normalizeSqlForDigestMatch(sql: string): string {
  const normalized = normalizeSql(sql).replace(/`([^`]+)`/g, "$1");
  let result = "";
  let index = 0;
  let quoteState: "'" | '"' | "none" = "none";

  while (index < normalized.length) {
    const char = normalized[index];

    if (quoteState === "none") {
      if (char === "'" || char === '"') {
        quoteState = char;
        result += "?";
        index += 1;
        continue;
      }
      if (
        /[0-9]/.test(char) &&
        (index === 0 || !/[A-Za-z0-9_$]/.test(normalized[index - 1] ?? ""))
      ) {
        result += "?";
        index += 1;
        while (
          index < normalized.length &&
          /[A-Za-z0-9_.+-]/.test(normalized[index])
        ) {
          index += 1;
        }
        continue;
      }
      result += char;
      index += 1;
      continue;
    }

    if (char === quoteState) {
      if (normalized[index + 1] === quoteState) {
        index += 2;
        continue;
      }
      quoteState = "none";
    }
    index += 1;
  }

  return result
    .replace(/\bNULL\b/gi, "?")
    .replace(/\b(TRUE|FALSE)\b/gi, "?")
    .replace(/\s*([=<>!+\-*/%,()])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function digestMatchScore(sql: string, candidate: StatementDigestRow): number {
  const normalizedSql = normalizeSql(sql);
  const normalizedSqlHash = sqlHash(normalizedSql);
  const sqlShape = normalizeSqlForDigestMatch(sql);

  if (
    candidate.querySampleText &&
    sqlHash(normalizeSql(candidate.querySampleText)) === normalizedSqlHash
  ) {
    return 100;
  }

  if (
    candidate.querySampleText &&
    normalizeSqlForDigestMatch(candidate.querySampleText) === sqlShape
  ) {
    return 80;
  }

  if (
    candidate.digestText &&
    normalizeSqlForDigestMatch(candidate.digestText) === sqlShape
  ) {
    return 70;
  }

  return 0;
}

export function extractPlanTableNames(plan: ExplainResult["plan"]): string[] {
  const names = plan
    .map((row) => {
      if (!row || typeof row !== "object") {
        return undefined;
      }
      const candidate =
        (row.table as unknown) ??
        (row.table_name as unknown) ??
        (row.TABLE as unknown);
      return typeof candidate === "string" ? candidate.trim() : undefined;
    })
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.length > 0 &&
        value.toUpperCase() !== "NULL" &&
        !value.startsWith("<"),
    );
  return [...new Set(names)];
}

export function extractSqlTableNameHints(sql: string): string[] {
  const hints = new Set<string>();
  const pattern =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z0-9_$]+)`?(?:\s*\.\s*`?([A-Za-z0-9_$]+)`?)?/gi;
  let match = pattern.exec(sql);
  while (match) {
    hints.add(match[2] ?? match[1]);
    match = pattern.exec(sql);
  }
  return [...hints];
}
