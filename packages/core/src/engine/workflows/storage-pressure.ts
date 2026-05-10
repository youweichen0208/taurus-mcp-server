import type { SessionContext } from "../../context/session-context.js";
import type { MetricAlias } from "../../diagnostics/metrics-source.js";
import type {
  DiagnoseStoragePressureInput,
  DiagnosticResult,
} from "../../diagnostics/types.js";
import type { TaurusDBEngine } from "../../engine.js";
import {
  queryMetricsSafely,
  type StatementDigestRow,
  type TableStorageRow,
} from "../helpers.js";
import { buildStoragePressureDiagnosis } from "./storage-pressure-helpers.js";

const STORAGE_PRESSURE_METRICS: MetricAlias[] = [
  "storage_used_size",
  "storage_write_delay",
  "storage_read_delay",
  "write_iops",
  "read_iops",
  "write_throughput",
  "read_throughput",
  "temp_tables_per_min",
];

export async function diagnoseStoragePressure(
  engine: TaurusDBEngine,
  input: DiagnoseStoragePressureInput,
  ctx: SessionContext,
): Promise<DiagnosticResult> {
  const [digestRows, tableRows, metrics] = await Promise.all([
    engine.findStorageStatementDigests(input, ctx).catch(
      () => [] as StatementDigestRow[],
    ),
    engine.findTableStorageStats(input, ctx).catch(
      () => [] as TableStorageRow[],
    ),
    queryMetricsSafely(engine.metricsSource, STORAGE_PRESSURE_METRICS, input, ctx),
  ]);

  return buildStoragePressureDiagnosis({
    diagnosisInput: input,
    ctx,
    digestRows,
    tableRows,
    metrics,
    metricsSource: engine.metricsSource,
  });
}
