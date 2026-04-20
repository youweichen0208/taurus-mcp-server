export type QueryState = "running" | "completed" | "failed" | "cancelled";
export interface QueryInfo {
    queryId: string;
    taskId: string;
    datasource: string;
    mode: "ro" | "rw";
    statementType?: string;
    sqlHash?: string;
    startedAt: number;
    dbConnectionId?: number;
    status: QueryState;
    endedAt?: number;
    durationMs?: number;
    error?: string;
}
export interface QueryStatusResult {
    status: Exclude<QueryState, "running">;
    endedAt?: number;
    durationMs?: number;
    error?: string;
}
export interface QueryTracker {
    register(queryId: string, info: QueryInfo): void;
    get(queryId: string): QueryInfo | undefined;
    markCompleted(queryId: string, result: QueryStatusResult): void;
    listActive(): QueryInfo[];
    cleanup(olderThanMs: number): void;
}
export type QueryTrackerOptions = {
    now?: () => number;
    historyLimit?: number;
};
export declare class InMemoryQueryTracker implements QueryTracker {
    private readonly now;
    private readonly historyLimit;
    private readonly items;
    constructor(options?: QueryTrackerOptions);
    register(queryId: string, info: QueryInfo): void;
    get(queryId: string): QueryInfo | undefined;
    markCompleted(queryId: string, result: QueryStatusResult): void;
    listActive(): QueryInfo[];
    cleanup(olderThanMs: number): void;
    private evictIfNeeded;
}
export declare function createQueryTracker(options?: QueryTrackerOptions): QueryTracker;
