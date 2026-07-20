import type { Config } from "../../config/index.js";

export type DatabaseEngine = "mysql" | "postgresql";

export type CredentialRef =
  | { type: "plain"; value: string }
  | { type: "env"; key: string }
  | { type: "file"; path: string }
  | { type: "uri"; uri: string };

export interface UserCredential {
  username: string;
  password: CredentialRef;
}

export interface TlsOptions {
  enabled?: boolean;
  rejectUnauthorized?: boolean;
  servername?: string;
  ca?: CredentialRef;
  cert?: CredentialRef;
  key?: CredentialRef;
}

export interface DataSourceProfile {
  name: string;
  engine: DatabaseEngine;
  host?: string;
  port: number;
  database?: string;
  instanceId?: string;
  nodeId?: string;
  /** Session credential used by guarded query tools and the human-gated recovery path. */
  user?: UserCredential;
  tls?: TlsOptions;
  poolSize?: number;
  toString(): string;
}

export interface ProfileLoader {
  load(): Promise<Map<string, DataSourceProfile>>;
  getDefault(): Promise<string | undefined>;
  get(name: string): Promise<DataSourceProfile | undefined>;
}

export interface RuntimeDataSourceTarget {
  host?: string;
  port?: number;
  database?: string;
  user?: UserCredential;
  instanceId?: string;
  nodeId?: string;
}

export interface RuntimeTargetProfileLoader extends ProfileLoader {
  setRuntimeTarget(name: string, target: RuntimeDataSourceTarget): void;
  clearRuntimeUser(name: string): void;
  clearRuntimeTarget(name: string): void;
  clearAllRuntimeTargets(): void;
  getRuntimeTarget(name: string): RuntimeDataSourceTarget | undefined;
}

export type SqlProfileLoaderOptions = {
  config: Config;
  env?: NodeJS.ProcessEnv;
};

export type LoadedProfiles = {
  profiles: Map<string, DataSourceProfile>;
  defaultDatasource?: string;
};
