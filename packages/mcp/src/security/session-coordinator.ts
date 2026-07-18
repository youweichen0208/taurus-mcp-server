type PendingWriter = {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export class SessionCoordinator {
  private readers = 0;
  private writerActive = false;
  private readonly readerQueue: Array<() => void> = [];
  private readonly writerQueue: PendingWriter[] = [];

  async runShared<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writerActive || this.writerQueue.length > 0) {
      await new Promise<void>((resolve) => this.readerQueue.push(resolve));
    }
    this.readers += 1;
    try {
      return await operation();
    } finally {
      this.readers -= 1;
      this.drain();
    }
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.writerQueue.push({
        operation,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.writerActive || this.readers > 0) {
      return;
    }
    const writer = this.writerQueue.shift();
    if (writer) {
      this.writerActive = true;
      void writer.operation().then(writer.resolve, writer.reject).finally(() => {
        this.writerActive = false;
        this.drain();
      });
      return;
    }
    for (const resolve of this.readerQueue.splice(0)) {
      resolve();
    }
  }
}
