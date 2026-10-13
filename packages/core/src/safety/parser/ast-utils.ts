import type { AstNode, ColumnRef, LimitNode, ParseError, ParserErrorLike, StatementType, TableRef, WhereNode } from "./types.js";

export function isObject(value: unknown): value is AstNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mapStatementType(value: unknown): StatementType {
  const type = typeof value === "string" ? value.toLowerCase() : "";
  switch (type) {
    case "select":
      return "select";
    case "show":
      return "show";
    case "explain":
      return "explain";
    case "desc":
    case "describe":
      return "describe";
    case "insert":
    case "replace":
      return "insert";
    case "update":
      return "update";
    case "delete":
      return "delete";
    case "alter":
      return "alter";
    case "drop":
      return "drop";
    case "create":
      return "create";
    case "grant":
      return "grant";
    case "revoke":
      return "revoke";
    case "truncate":
      return "truncate";
    case "set":
      return "set";
    case "use":
      return "use";
    default:
      return "unknown";
  }
}

export function normalizeTableList(tableList: string[]): TableRef[] {
  const items: TableRef[] = [];
  const seen = new Set<string>();

  for (const entry of tableList) {
    const parts = entry.split("::");
    if (parts.length < 3) {
      continue;
    }

    const schema = parts[1] && parts[1] !== "null" ? parts[1] : undefined;
    const name = parts.slice(2).join("::").trim();
    if (!name) {
      continue;
    }

    const dedupeKey = `${schema ?? ""}.${name}`.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    items.push({ name, schema });
  }

  return items;
}

export function normalizeColumnList(columnList: string[]): ColumnRef[] {
  const items: ColumnRef[] = [];
  const seen = new Set<string>();

  for (const entry of columnList) {
    const parts = entry.split("::");
    if (parts.length < 3) {
      continue;
    }

    const table = parts[1] && parts[1] !== "null" ? parts[1] : undefined;
    const name = parts.slice(2).join("::").trim();
    if (!name) {
      continue;
    }

    const dedupeKey = `${table ?? ""}.${name}`.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    items.push({ name, table });
  }

  return items;
}

export function readNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function toWhereNode(raw: unknown): WhereNode {
  const type = isObject(raw) && typeof raw.type === "string" ? raw.type.toLowerCase() : "";
  return {
    kind: type === "binary_expr" ? "binary" : "expression",
    raw,
  };
}

export function toLimitNode(raw: unknown): LimitNode {
  if (!isObject(raw) || !Array.isArray(raw.value)) {
    return { raw };
  }

  const values = raw.value
    .map((entry) => {
      if (!isObject(entry)) {
        return undefined;
      }
      return readNumericValue(entry.value);
    })
    .filter((value): value is number => value !== undefined);

  const rowCount = values.length > 0 ? values[values.length - 1] : undefined;
  const offset = values.length > 1 ? values[0] : undefined;
  return {
    raw,
    rowCount,
    offset,
  };
}

export function getFunctionName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const token = value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (isObject(entry) && typeof entry.value === "string") {
          return entry.value;
        }
        return undefined;
      })
      .find((entry): entry is string => typeof entry === "string");
    return token;
  }
  if (isObject(value)) {
    if (typeof value.name === "string") {
      return value.name;
    }
    return getFunctionName(value.name);
  }
  return undefined;
}

function identifierValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isObject(value) && typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

/**
 * Resolves the full name of a node-sql-parser function node, keeping the
 * schema qualifier that getFunctionName() drops.
 */
export function getQualifiedFunctionName(
  value: unknown,
): { name: string; schema?: string } | undefined {
  if (typeof value === "string") {
    return { name: value };
  }
  if (!isObject(value)) {
    return undefined;
  }
  const parts = Array.isArray(value.name)
    ? value.name.map(identifierValue)
    : [identifierValue(value.name)];
  if (parts.length === 0 || parts.some((part) => part === undefined)) {
    return undefined;
  }
  const names = parts as string[];
  const schema = identifierValue(value.schema);
  const name = names[names.length - 1];
  const qualifier = [schema, ...names.slice(0, -1)].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return qualifier.length > 0 ? { name, schema: qualifier.join(".") } : { name };
}

export function toParseError(error: unknown): ParseError {
  const typed = error as ParserErrorLike;
  const message = typed instanceof Error ? typed.message : String(error);
  const line = typed.location?.start?.line;
  const column = typed.location?.start?.column;

  return {
    code: "SQL_PARSE_ERROR",
    message,
    position:
      typeof line === "number" && typeof column === "number"
        ? {
            line,
            column,
          }
        : undefined,
  };
}
