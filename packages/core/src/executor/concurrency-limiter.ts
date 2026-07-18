export class QueryConcurrencyError extends Error {
  readonly code = "SERVER_BUSY";

  constructor(message: string) {
    super(message);
    this.name = "QueryConcurrencyError";
  }
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class QueryConcurrencyLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly queueTimeoutMs: number,
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(
        new QueryConcurrencyError("Query concurrency queue is full."),
      );
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(new QueryConcurrencyError("Timed out waiting for query capacity."));
        }, this.queueTimeoutMs),
      };
      this.queue.push(waiter);
    });
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const waiter = this.queue.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.releaseFactory());
        return;
      }
      this.active -= 1;
    };
  }
}
