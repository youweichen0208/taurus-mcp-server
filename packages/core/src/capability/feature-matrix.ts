import type {
  FeatureMatrix,
  FeatureStatus,
  KernelInfo,
  TaurusFeatureName,
} from "./types.js";
import { isKernelVersionAtLeast } from "./version.js";

type ProbeVariables = Partial<Record<string, string>>;

const FEATURE_MIN_VERSIONS: Partial<Record<TaurusFeatureName, string>> = {
  flashback_query: "2.0.69.250900",
  recycle_bin: "2.0.57.240900",
  statement_outline: "2.0.42.230600",
  column_compression: "2.0.54.240600",
  multi_tenant: "2.0.54.240600",
  partition_mdl: "2.0.57.240900",
  dynamic_masking: "2.0.69.250900",
  nonblocking_ddl: "2.0.54.240600",
  hot_row_update: "2.0.54.240600",
};

function normalizeBooleanVariable(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["on", "1", "true", "yes", "enabled"].includes(normalized)) {
    return true;
  }
  if (["off", "0", "false", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function makeUnavailable(reason: string, minVersion?: string): FeatureStatus {
  return {
    available: false,
    enabled: false,
    minVersion,
    reason,
  };
}

function makeVersionGatedFeature(
  kernelInfo: KernelInfo,
  feature: TaurusFeatureName,
  reasonWhenUnavailable?: string,
): FeatureStatus {
  const minVersion = FEATURE_MIN_VERSIONS[feature];
  if (!kernelInfo.isTaurusDB) {
    return makeUnavailable("Instance is not TaurusDB.", minVersion);
  }
  if (!minVersion) {
    return {
      available: true,
      minVersion,
    };
  }
  if (!isKernelVersionAtLeast(kernelInfo.kernelVersion, minVersion)) {
    return makeUnavailable(
      reasonWhenUnavailable ??
        `Requires kernel version >= ${minVersion}, current: ${kernelInfo.kernelVersion ?? "unknown"}.`,
      minVersion,
    );
  }
  return {
    available: true,
    minVersion,
  };
}

function inferOffsetPushdown(optimizerSwitch: string | undefined): boolean | undefined {
  if (!optimizerSwitch) {
    return undefined;
  }
  const match = optimizerSwitch.match(/(?:^|,)offset_pushdown=(on|off)(?:,|$)/i);
  if (!match) {
    return undefined;
  }
  return match[1].toLowerCase() === "on";
}

export function buildUnavailableFeatureMatrix(reason = "Instance is not TaurusDB."): FeatureMatrix {
  return {
    flashback_query: makeUnavailable(reason, FEATURE_MIN_VERSIONS.flashback_query),
    parallel_query: makeUnavailable(reason),
    ndp_pushdown: makeUnavailable(reason),
    offset_pushdown: makeUnavailable(reason),
    recycle_bin: makeUnavailable(reason, FEATURE_MIN_VERSIONS.recycle_bin),
    statement_outline: makeUnavailable(reason, FEATURE_MIN_VERSIONS.statement_outline),
    column_compression: makeUnavailable(reason, FEATURE_MIN_VERSIONS.column_compression),
    multi_tenant: makeUnavailable(reason, FEATURE_MIN_VERSIONS.multi_tenant),
    partition_mdl: makeUnavailable(reason, FEATURE_MIN_VERSIONS.partition_mdl),
    dynamic_masking: makeUnavailable(reason, FEATURE_MIN_VERSIONS.dynamic_masking),
    nonblocking_ddl: makeUnavailable(reason, FEATURE_MIN_VERSIONS.nonblocking_ddl),
    hot_row_update: makeUnavailable(reason, FEATURE_MIN_VERSIONS.hot_row_update),
  };
}

export function buildFeatureMatrix(
  kernelInfo: KernelInfo,
  variables: ProbeVariables = {},
): FeatureMatrix {
  if (!kernelInfo.isTaurusDB) {
    return buildUnavailableFeatureMatrix();
  }

  const flashbackEnabled = normalizeBooleanVariable(variables.innodb_rds_backquery_enable);
  const parallelSetting = variables.force_parallel_execute;
  const parallelEnabled = normalizeBooleanVariable(parallelSetting);
  const offsetPushdownEnabled = inferOffsetPushdown(variables.optimizer_switch);
  const ndpModeRaw =
    variables.rds_ndp_mode ??
    variables.taurus_ndp_mode ??
    variables.ndp_pushdown_mode ??
    variables.ndp_pushdown;
  const ndpMode =
    ndpModeRaw?.toUpperCase() === "REPLICA_ON" ||
    ndpModeRaw?.toUpperCase() === "ON" ||
    ndpModeRaw?.toUpperCase() === "OFF"
      ? (ndpModeRaw.toUpperCase() as "OFF" | "ON" | "REPLICA_ON")
      : undefined;
  const multiTenantActive = normalizeBooleanVariable(
    variables.rds_multi_tenant ?? variables.multi_tenant_mode,
  );

  const flashback = makeVersionGatedFeature(kernelInfo, "flashback_query");
  if (flashback.available) {
    flashback.enabled = flashbackEnabled ?? true;
  }

  const recycleBin = makeVersionGatedFeature(kernelInfo, "recycle_bin");
  if (recycleBin.available) {
    recycleBin.enabled = true;
  }

  const statementOutline = makeVersionGatedFeature(kernelInfo, "statement_outline");
  const columnCompression = makeVersionGatedFeature(kernelInfo, "column_compression");
  const multiTenant: FeatureMatrix["multi_tenant"] = makeVersionGatedFeature(
    kernelInfo,
    "multi_tenant",
  );
  if (multiTenant.available) {
    multiTenant.active = multiTenantActive ?? false;
    multiTenant.enabled = multiTenantActive ?? false;
  }
  const partitionMdl = makeVersionGatedFeature(kernelInfo, "partition_mdl");
  const dynamicMasking = makeVersionGatedFeature(kernelInfo, "dynamic_masking");
  const nonblockingDdl = makeVersionGatedFeature(kernelInfo, "nonblocking_ddl");
  const hotRowUpdate = makeVersionGatedFeature(kernelInfo, "hot_row_update");

  return {
    flashback_query: flashback,
    parallel_query: {
      available: true,
      enabled: parallelEnabled ?? false,
      param: parallelSetting ? `force_parallel_execute=${parallelSetting}` : undefined,
    },
    ndp_pushdown: {
      available: true,
      enabled: ndpMode ? ndpMode !== "OFF" : true,
      mode: ndpMode,
    },
    offset_pushdown: {
      available: true,
      enabled: offsetPushdownEnabled ?? true,
    },
    recycle_bin: recycleBin,
    statement_outline: statementOutline,
    column_compression: columnCompression,
    multi_tenant: multiTenant,
    partition_mdl: partitionMdl,
    dynamic_masking: dynamicMasking,
    nonblocking_ddl: nonblockingDdl,
    hot_row_update: hotRowUpdate,
  };
}
