function cloneInfo(info) {
    return { ...info };
}
export class InMemoryQueryTracker {
    now;
    historyLimit;
    items = new Map();
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.historyLimit = options.historyLimit ?? 500;
    }
    register(queryId, info) {
        this.items.set(queryId, cloneInfo(info));
        this.evictIfNeeded();
    }
    get(queryId) {
        const info = this.items.get(queryId);
        return info ? cloneInfo(info) : undefined;
    }
    markCompleted(queryId, result) {
        const existing = this.items.get(queryId);
        if (!existing) {
            return;
        }
        const endedAt = result.endedAt ?? this.now();
        const durationMs = result.durationMs ?? Math.max(0, endedAt - existing.startedAt);
        existing.status = result.status;
        existing.endedAt = endedAt;
        existing.durationMs = durationMs;
        existing.error = result.error;
        this.items.set(queryId, existing);
        this.evictIfNeeded();
    }
    listActive() {
        const active = [];
        for (const info of this.items.values()) {
            if (info.status === "running") {
                active.push(cloneInfo(info));
            }
        }
        return active.sort((a, b) => a.startedAt - b.startedAt);
    }
    cleanup(olderThanMs) {
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
    evictIfNeeded() {
        if (this.items.size <= this.historyLimit) {
            return;
        }
        const removable = [];
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
export function createQueryTracker(options = {}) {
    return new InMemoryQueryTracker(options);
}
