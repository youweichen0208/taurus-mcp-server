import type { MutationOptions, MutationResult, QueryResult, ReadonlyOptions } from "../executor/sql-executor.js";

export interface RestoreRecycleBinTableInput {
  recycleTable: string;
  method?: "native_restore" | "insert_select";
  destinationDatabase?: string;
  destinationTable?: string;
}

export const RECYCLE_BIN_DATABASE = "__recyclebin__";

const SIMPLE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const RECYCLE_TABLE_PATTERN = /^[A-Za-z0-9_$@.-]+$/;

function quoteIdentifier(identifier: string, fieldName: string): string {
  if (!SIMPLE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid ${fieldName}: "${identifier}".`);
  }
  return `\`${identifier}\``;
}

function quoteRecycleTableName(table: string): string {
  if (!RECYCLE_TABLE_PATTERN.test(table)) {
    throw new Error(`Invalid recycle_table: "${table}".`);
  }
  return `\`${table.replace(/`/g, "``")}\``;
}

function quoteStringLiteral(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: value cannot be empty.`);
  }
  if (trimmed !== value) {
    throw new Error(`Invalid ${fieldName}: extra leading or trailing spaces are not allowed.`);
  }
  if (!RECYCLE_TABLE_PATTERN.test(trimmed) && fieldName === "recycle_table") {
    throw new Error(`Invalid recycle_table: "${value}".`);
  }
  return `'${trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function buildListRecycleBinSql(): string {
  return "call dbms_recyclebin.show_tables()";
}

export function buildRestoreRecycleBinTableSql(input: RestoreRecycleBinTableInput): string {
  const method = input.method ?? "native_restore";
  const recycleTable = quoteStringLiteral(input.recycleTable, "recycle_table");

  if (method === "native_restore") {
    if (input.destinationDatabase || input.destinationTable) {
      if (!input.destinationDatabase || !input.destinationTable) {
        throw new Error(
          "native_restore requires destination_database and destination_table to be provided together.",
        );
      }
      return `call dbms_recyclebin.restore_table(${recycleTable}, ${quoteStringLiteral(
        input.destinationDatabase,
        "destination_database",
      )}, ${quoteStringLiteral(input.destinationTable, "destination_table")})`;
    }
    return `call dbms_recyclebin.restore_table(${recycleTable})`;
  }

  if (method === "insert_select") {
    if (!input.destinationDatabase || !input.destinationTable) {
      throw new Error(
        "insert_select restore requires destination_database and destination_table. Create the destination table with a compatible structure before calling this tool.",
      );
    }
    return `INSERT INTO ${quoteIdentifier(input.destinationDatabase, "destination_database")}.${quoteIdentifier(
      input.destinationTable,
      "destination_table",
    )} SELECT * FROM \`${RECYCLE_BIN_DATABASE}\`.${quoteRecycleTableName(input.recycleTable)}`;
  }

  throw new Error(`Unsupported restore method: ${method}.`);
}

export function recycleBinReadonlyOptions(opts?: ReadonlyOptions): ReadonlyOptions {
  return {
    maxRows: 100,
    maxColumns: 20,
    ...opts,
  };
}

export function recycleBinMutationOptions(opts?: MutationOptions): MutationOptions | undefined {
  return opts;
}

export type RecycleBinListResult = QueryResult;
export type RecycleBinRestoreResult = MutationResult;
