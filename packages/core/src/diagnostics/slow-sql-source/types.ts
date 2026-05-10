import type { FindTopSlowSqlInput, DiagnosisWindow } from "../types.js";
import type { SessionContext } from "../../context/session-context.js";

export interface ResolveSlowSqlInput {
  sqlHash?: string;
  digestText?: string;
  timeRange?: DiagnosisWindow;
}

export interface ExternalSlowSqlSample {
  source: string;
  sql: string;
  sqlHash: string;
  digestText?: string;
  database?: string;
  user?: string;
  clientIp?: string;
  startTime?: string;
  execCount?: number;
  avgLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  rowsSent?: number;
  rawRef?: string;
}

export interface SlowSqlSource {
  resolve(input: ResolveSlowSqlInput, ctx: SessionContext): Promise<ExternalSlowSqlSample | undefined>;
  findTop?(
    input: FindTopSlowSqlInput,
    ctx: SessionContext,
  ): Promise<ExternalSlowSqlSample[]>;
}

export type TaurusApiCandidate = {
  sql?: string;
  database?: string;
  user?: string;
  clientIp?: string;
  startTime?: string;
  execCount?: number;
  avgLatencyMs?: number;
  avgLockTimeMs?: number;
  avgRowsExamined?: number;
  rowsSent?: number;
  rawRef?: string;
};
