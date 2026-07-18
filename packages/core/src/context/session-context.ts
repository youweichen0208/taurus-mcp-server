import type { DatabaseEngine } from "../auth/sql-profile-loader.js";

export interface RuntimeLimits {
  readonly: boolean;
  timeoutMs: number;
  maxRows: number;
  maxColumns: number;
  maxFieldChars: number;
  maxResultBytes?: number;
  maxBlobBytes?: number;
}

export interface SessionContext {
  task_id: string;
  datasource: string;
  engine: DatabaseEngine;
  database?: string;
  schema?: string;
  host?: string;
  port?: number;
  projectId?: string;
  instanceId?: string;
  nodeId?: string;
  limits: RuntimeLimits;
}

export interface DatasourceResolveInput {
  datasource?: string;
  database?: string;
  schema?: string;
  timeout_ms?: number;
  readonly?: boolean;
}

export interface DatasourceResolver {
  resolve(input: DatasourceResolveInput, task_id: string): Promise<SessionContext>;
}
