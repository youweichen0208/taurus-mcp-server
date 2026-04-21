export interface KernelInfo {
  isTaurusDB: boolean;
  kernelVersion?: string;
  mysqlCompat: "5.7" | "8.0" | "unknown";
  instanceSpecHint?: "small" | "medium" | "large";
  rawVersion: string;
}

export type FeatureStatus = {
  available: boolean;
  enabled?: boolean;
  minVersion?: string;
  reason?: string;
};

export interface FeatureMatrix {
  flashback_query: FeatureStatus;
  parallel_query: FeatureStatus & { param?: string };
  ndp_pushdown: FeatureStatus & { mode?: "OFF" | "ON" | "REPLICA_ON" };
  offset_pushdown: FeatureStatus;
  recycle_bin: FeatureStatus;
  statement_outline: FeatureStatus;
  column_compression: FeatureStatus;
  multi_tenant: FeatureStatus & { active?: boolean };
  partition_mdl: FeatureStatus;
  dynamic_masking: FeatureStatus;
  nonblocking_ddl: FeatureStatus;
  hot_row_update: FeatureStatus;
}

export type TaurusFeatureName = keyof FeatureMatrix;

export interface CapabilitySnapshot {
  kernelInfo: KernelInfo;
  features: FeatureMatrix;
  checkedAt: number;
}

export class UnsupportedFeatureError extends Error {
  readonly code = "UNSUPPORTED_FEATURE";
  readonly feature: TaurusFeatureName;
  readonly requiredVersion?: string;
  readonly currentVersion?: string;

  constructor(
    feature: TaurusFeatureName,
    message: string,
    options: {
      requiredVersion?: string;
      currentVersion?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "UnsupportedFeatureError";
    this.feature = feature;
    this.requiredVersion = options.requiredVersion;
    this.currentVersion = options.currentVersion;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
