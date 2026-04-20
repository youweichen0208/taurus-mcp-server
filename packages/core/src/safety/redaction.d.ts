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
export declare function createResultRedactor(): ResultRedactor;
