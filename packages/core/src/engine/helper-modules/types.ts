export type ProcesslistRow = {
  sessionId?: string;
  user?: string;
  host?: string;
  databaseName?: string;
  command?: string;
  timeSeconds?: number;
  state?: string;
  infoPreview?: string;
};

export type LockWaitRow = {
  waitingSessionId?: string;
  waitingUser?: string;
  waitingState?: string;
  waitingTrxState?: string;
  waitAgeSeconds?: number;
  blockingSessionId?: string;
  blockingUser?: string;
  blockingState?: string;
  blockingTrxState?: string;
  blockingTrxAgeSeconds?: number;
  lockedSchema?: string;
  lockedTable?: string;
  lockedIndex?: string;
  waitingLockType?: string;
  waitingLockMode?: string;
  blockingLockType?: string;
  blockingLockMode?: string;
  waitingQuery?: string;
  blockingQuery?: string;
};

export type MetadataLockRow = {
  waitingSessionId?: string;
  waitingUser?: string;
  waitingState?: string;
  blockingSessionId?: string;
  blockingUser?: string;
  blockingState?: string;
  objectType?: string;
  objectSchema?: string;
  objectName?: string;
  waitingLockType?: string;
  waitingLockDuration?: string;
  blockingLockType?: string;
  blockingLockDuration?: string;
};

export type DeadlockSummary = {
  detectedAt?: string;
  summary: string;
  waitingTables: string[];
  blockingTables: string[];
  transactionIds: string[];
};

export type StatementDigestRow = {
  schemaName?: string;
  digest?: string;
  digestText?: string;
  querySampleText?: string;
  execCount?: number;
  avgLatencyMs?: number;
  totalLatencyMs?: number;
  maxLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  avgSortRows?: number;
  avgTmpTables?: number;
  avgTmpDiskTables?: number;
  selectScanCount?: number;
  noIndexUsedCount?: number;
};

export type StatementWaitEventRow = {
  eventName?: string;
  sampleCount?: number;
  statementCount?: number;
  totalWaitMs?: number;
  avgWaitMs?: number;
};

export type PlanTableStats = {
  table: string;
  rowCountEstimate?: number;
  indexCount: number;
  primaryKey?: string[];
};

export type TableStorageRow = {
  schemaName?: string;
  tableName?: string;
  engine?: string;
  rowCountEstimate?: number;
  totalMb?: number;
  dataMb?: number;
  indexMb?: number;
  dataFreeMb?: number;
};

export type ReplicationStatusRow = {
  channelName?: string;
  replicaIoRunning?: string;
  replicaSqlRunning?: string;
  secondsBehindSource?: number;
  retrievedGtidSet?: string;
  executedGtidSet?: string;
  lastIoError?: string;
  lastSqlError?: string;
};
