import { createHash } from "node:crypto";

const SQL_KEYWORDS = new Set(
  [
    "select",
    "show",
    "describe",
    "desc",
    "explain",
    "from",
    "where",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "on",
    "as",
    "distinct",
    "union",
    "all",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "alter",
    "drop",
    "truncate",
    "table",
    "database",
    "schema",
    "if",
    "exists",
    "not",
    "null",
    "and",
    "or",
    "in",
    "is",
    "like",
    "between",
    "case",
    "when",
    "then",
    "else",
    "end",
    "asc",
    "desc",
    "with",
    "recursive",
    "grant",
    "revoke",
    "begin",
    "commit",
    "rollback",
  ].map((keyword) => keyword.toLowerCase()),
);

type QuoteState = "none" | "'" | '"' | "`";

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function stripSqlComments(sql: string): string {
  let result = "";
  let quoteState: QuoteState = "none";
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quoteState === "none") {
      if (char === "'" || char === '"' || char === "`") {
        quoteState = char;
        result += char;
        index += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        if (result.length > 0 && !isWhitespace(result[result.length - 1])) {
          result += " ";
        }
        index += 2;
        while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
          index += 1;
        }
        if (index < sql.length) {
          index += 2;
        }
        continue;
      }

      if (char === "-" && next === "-") {
        if (result.length > 0 && !isWhitespace(result[result.length - 1])) {
          result += " ";
        }
        index += 2;
        while (index < sql.length && sql[index] !== "\n") {
          index += 1;
        }
        continue;
      }

      if (char === "#") {
        if (result.length > 0 && !isWhitespace(result[result.length - 1])) {
          result += " ";
        }
        index += 1;
        while (index < sql.length && sql[index] !== "\n") {
          index += 1;
        }
        continue;
      }
    } else if (char === quoteState) {
      if (sql[index + 1] === quoteState) {
        result += char;
        result += sql[index + 1];
        index += 2;
        continue;
      }
      quoteState = "none";
      result += char;
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function trimLineEndWhitespace(sql: string): string {
  return sql
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

function collapseWhitespaceOutsideLiterals(sql: string): string {
  let result = "";
  let quoteState: QuoteState = "none";
  let pendingSpace = false;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (quoteState === "none") {
      if (char === "'" || char === '"' || char === "`") {
        if (pendingSpace && result.length > 0) {
          result += " ";
        }
        pendingSpace = false;
        quoteState = char;
        result += char;
        index += 1;
        continue;
      }

      if (isWhitespace(char)) {
        pendingSpace = true;
        index += 1;
        continue;
      }

      if (pendingSpace && result.length > 0) {
        result += " ";
      }
      pendingSpace = false;
      result += char;
      index += 1;
      continue;
    }

    result += char;
    if (char === quoteState) {
      if (sql[index + 1] === quoteState) {
        result += sql[index + 1];
        index += 2;
        continue;
      }
      quoteState = "none";
    }
    index += 1;
  }

  return result.trim();
}

function uppercaseKeywordsOutsideLiterals(sql: string): string {
  let result = "";
  let quoteState: QuoteState = "none";
  let index = 0;
  let currentWord = "";

  const flushWord = () => {
    if (currentWord.length === 0) {
      return;
    }
    const lower = currentWord.toLowerCase();
    result += SQL_KEYWORDS.has(lower) ? lower.toUpperCase() : currentWord;
    currentWord = "";
  };

  while (index < sql.length) {
    const char = sql[index];

    if (quoteState === "none") {
      if (char === "'" || char === '"' || char === "`") {
        flushWord();
        quoteState = char;
        result += char;
        index += 1;
        continue;
      }

      if (isWordChar(char)) {
        currentWord += char;
      } else {
        flushWord();
        result += char;
      }
      index += 1;
      continue;
    }

    flushWord();
    result += char;
    if (char === quoteState) {
      if (sql[index + 1] === quoteState) {
        result += sql[index + 1];
        index += 2;
        continue;
      }
      quoteState = "none";
    }
    index += 1;
  }

  flushWord();
  return result;
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/\s*;\s*$/, "").trim();
}

export function normalizeSql(sql: string): string {
  const withoutComments = stripSqlComments(sql);
  const lineTrimmed = trimLineEndWhitespace(withoutComments);
  const collapsed = collapseWhitespaceOutsideLiterals(lineTrimmed);
  const keywordUppercased = uppercaseKeywordsOutsideLiterals(collapsed);
  return stripTrailingSemicolon(keywordUppercased);
}

export function sqlHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
