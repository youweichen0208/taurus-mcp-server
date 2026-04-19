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

function cloneInfo(info: QueryInfo): QueryInfo {
  return { ...info };
}

export class InMemoryQueryTracker implements QueryTracker {
  private readonly now: () => number;
  private readonly historyLimit: number;
  private readonly items = new Map<string, QueryInfo>();

  constructor(options: QueryTrackerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.historyLimit = options.historyLimit ?? 500;
  }

  register(queryId: string, info: QueryInfo): void {
    this.items.set(queryId, cloneInfo(info));
    this.evictIfNeeded();
  }

  get(queryId: string): QueryInfo | undefined {
    const info = this.items.get(queryId);
    return info ? cloneInfo(info) : undefined;
  }

  markCompleted(queryId: string, result: QueryStatusResult): void {
    const existing = this.items.get(queryId);
    if (!existing) {
      return;
    }

    const endedAt = result.endedAt ?? this.now();
    const durationMs =
      result.durationMs ?? Math.max(0, endedAt - existing.startedAt);

    existing.status = result.status;
    existing.endedAt = endedAt;
    existing.durationMs = durationMs;
    existing.error = result.error;
    this.items.set(queryId, existing);
    this.evictIfNeeded();
  }

  listActive(): QueryInfo[] {
    const active: QueryInfo[] = [];
    for (const info of this.items.values()) {
      if (info.status === "running") {
        active.push(cloneInfo(info));
      }
    }
    return active.sort((a, b) => a.startedAt - b.startedAt);
  }

  cleanup(olderThanMs: number): void {
    if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
      return;
    }
    const threshold = this.now() - olderThanMs;

    for (const [queryId, info] of this.items.entries()) {
      if (info.status === "running") {
        continue;
      }

      const referenceTime = info.endedAt ?? info.startedAt;
      if (referenceTime <= threshold) {
        this.items.delete(queryId);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.items.size <= this.historyLimit) {
      return;
    }

    const removable: Array<{ queryId: string; refTime: number }> = [];
    for (const [queryId, info] of this.items.entries()) {
      if (info.status === "running") {
        continue;
      }
      removable.push({
        queryId,
        refTime: info.endedAt ?? info.startedAt,
      });
    }

    removable.sort((a, b) => a.refTime - b.refTime);
    for (const entry of removable) {
      if (this.items.size <= this.historyLimit) {
        break;
      }
      this.items.delete(entry.queryId);
    }
  }
}

export function createQueryTracker(
  options: QueryTrackerOptions = {},
): QueryTracker {
  return new InMemoryQueryTracker(options);
}
