import type { SessionContext } from "../../context/session-context.js";
import type { MetricSummary, MetricsSource } from "../../diagnostics/metrics-source.js";
import type {
  DiagnoseStoragePressureInput,
  DiagnosticNextToolInput,
  DiagnosticResult,
  DiagnosticRootCauseCandidate,
  DiagnosticSeverity,
} from "../../diagnostics/types.js";
import { normalizeSql, sqlHash } from "../../utils/hash.js";
import {
  buildDbHotspotNextToolInput,
  buildFindTopSlowSqlNextToolInput,
  buildSlowQueryNextToolInput,
  clampInteger,
  dedupeNextToolInputs,
  metricSummaryText,
  metricsSourceLimitation,
  pickMetric,
  roundMetric,
  withDatasourceSummary,
  type StatementDigestRow,
  type TableStorageRow,
} from "../helpers.js";

export function buildStoragePressureDiagnosis(input: {
  diagnosisInput: DiagnoseStoragePressureInput;
  ctx: SessionContext;
  digestRows: StatementDigestRow[];
  tableRows: TableStorageRow[];
  metrics: MetricSummary[];
  metricsSource?: MetricsSource;
}): DiagnosticResult {
  const { diagnosisInput, ctx, digestRows, tableRows, metrics, metricsSource } =
    input;
  const maxCandidates = clampInteger(diagnosisInput.maxCandidates, 5, 1, 10);
  const storageUsedMetric = pickMetric(metrics, "storage_used_size");
  const writeDelayMetric = pickMetric(metrics, "storage_write_delay");
  const readDelayMetric = pickMetric(metrics, "storage_read_delay");
  const writeIopsMetric = pickMetric(metrics, "write_iops");
  const readIopsMetric = pickMetric(metrics, "read_iops");
  const writeThroughputMetric = pickMetric(metrics, "write_throughput");
  const readThroughputMetric = pickMetric(metrics, "read_throughput");
  const tempTablesMetric = pickMetric(metrics, "temp_tables_per_min");
  const metricEvidence = metrics.map((metric) => ({
    source: "ces_metrics",
    title: `CES ${metric.alias}`,
    summary: metricSummaryText(metric),
  }));
  const recommendedNextTools = new Set<string>();
  const nextToolInputs: DiagnosticNextToolInput[] = [];

  const focusedTableName = diagnosisInput.table?.includes(".")
    ? diagnosisInput.table.split(".").slice(1).join(".")
    : diagnosisInput.table;
  const relevantDigests = digestRows.filter((row) => {
    if (!focusedTableName) {
      return true;
    }
    const target = focusedTableName.toUpperCase();
    return (
      row.digestText?.toUpperCase().includes(target) ||
      row.querySampleText?.toUpperCase().includes(target)
    );
  });
  const tmpDiskDigests = relevantDigests.filter(
    (row) => (row.avgTmpDiskTables ?? 0) > 0,
  );
  const tmpTableDigests = relevantDigests.filter(
    (row) => (row.avgTmpTables ?? 0) > 0,
  );
  const scanDigests = relevantDigests.filter(
    (row) =>
      (row.noIndexUsedCount ?? 0) > 0 ||
      (row.selectScanCount ?? 0) > 0 ||
      (row.avgRowsExamined ?? 0) >= 10_000,
  );
  const sortDigests = relevantDigests.filter(
    (row) => (row.avgSortRows ?? 0) >= 1_000,
  );
  const largeTables = tableRows.filter(
    (row) =>
      (row.totalMb ?? 0) >= 1024 ||
      (row.rowCountEstimate ?? 0) >= 1_000_000 ||
      (row.dataFreeMb ?? 0) >= 1024,
  );

  const rootCauseCandidates: DiagnosticRootCauseCandidate[] = [];
  if (tmpDiskDigests.length > 0) {
    const lead = tmpDiskDigests[0];
    rootCauseCandidates.push({
      code: "storage_pressure_tmp_disk_spill",
      title: "SQL workload is spilling temporary tables to disk",
      confidence: (lead.avgTmpDiskTables ?? 0) >= 1 ? "high" : "medium",
      rationale: `Digest summaries show temporary disk table usage${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgTmpDiskTables !== undefined ? `; avg_tmp_disk_tables=${lead.avgTmpDiskTables}` : ""}.`,
    });
  }
  if (scanDigests.length > 0) {
    const lead = scanDigests[0];
    rootCauseCandidates.push({
      code: "storage_pressure_scan_heavy_sql",
      title: "Scan-heavy SQL is driving storage pressure",
      confidence:
        (lead.noIndexUsedCount ?? 0) > 0 ||
        (lead.avgRowsExamined ?? 0) >= 100_000
          ? "high"
          : "medium",
      rationale: `Digest summaries show scan-heavy execution${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgRowsExamined !== undefined ? `; avg_rows_examined=${lead.avgRowsExamined}` : ""}${lead.noIndexUsedCount !== undefined ? `, no_index_used_count=${lead.noIndexUsedCount}` : ""}${lead.selectScanCount !== undefined ? `, select_scan_count=${lead.selectScanCount}` : ""}.`,
    });
  }
  if (sortDigests.length > 0 || tmpTableDigests.length > 0) {
    const lead = sortDigests[0] ?? tmpTableDigests[0];
    rootCauseCandidates.push({
      code: "storage_pressure_sort_or_tmp_table_workload",
      title: "Sort or temporary-table workload is increasing storage work",
      confidence:
        (lead.avgSortRows ?? 0) >= 10_000 || (lead.avgTmpTables ?? 0) >= 1
          ? "medium"
          : "low",
      rationale: `Digest summaries show sort or temporary-table work${lead.digestText ? ` for ${lead.digestText}` : ""}${lead.avgSortRows !== undefined ? `; avg_sort_rows=${lead.avgSortRows}` : ""}${lead.avgTmpTables !== undefined ? `, avg_tmp_tables=${lead.avgTmpTables}` : ""}.`,
    });
  }
  if (largeTables.length > 0) {
    const lead = largeTables[0];
    const qualifiedTable = [lead.schemaName, lead.tableName]
      .filter(Boolean)
      .join(".");
    rootCauseCandidates.push({
      code: "storage_pressure_large_or_fragmented_table",
      title: "Large or fragmented table may amplify storage work",
      confidence: "medium",
      rationale: `${qualifiedTable || "A table"} is among the largest local tables${lead.totalMb !== undefined ? `; total_mb=${lead.totalMb}` : ""}${lead.rowCountEstimate !== undefined ? `, row_count_estimate=${lead.rowCountEstimate}` : ""}${lead.dataFreeMb !== undefined ? `, data_free_mb=${lead.dataFreeMb}` : ""}.`,
    });
  }
  if ((writeDelayMetric?.max ?? 0) >= 50 || (readDelayMetric?.max ?? 0) >= 50) {
    rootCauseCandidates.push({
      code: "storage_pressure_ces_io_latency",
      title: "Cloud Eye shows elevated storage read/write latency",
      confidence:
        (writeDelayMetric?.max ?? 0) >= 100 ||
        (readDelayMetric?.max ?? 0) >= 100
          ? "high"
          : "medium",
      rationale: `CES storage latency crossed the current thresholds${writeDelayMetric?.max !== undefined ? `; max_write_delay=${roundMetric(writeDelayMetric.max)}` : ""}${readDelayMetric?.max !== undefined ? `, max_read_delay=${roundMetric(readDelayMetric.max)}` : ""}.`,
    });
  }
  if (
    (writeIopsMetric?.max ?? 0) >= 1000 ||
    (readIopsMetric?.max ?? 0) >= 1000 ||
    (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024 ||
    (readThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024
  ) {
    rootCauseCandidates.push({
      code: "storage_pressure_ces_io_throughput",
      title: "Cloud Eye shows elevated IOPS or throughput",
      confidence: "medium",
      rationale: `CES I/O workload metrics are elevated${writeIopsMetric?.max !== undefined ? `; max_write_iops=${roundMetric(writeIopsMetric.max)}` : ""}${readIopsMetric?.max !== undefined ? `, max_read_iops=${roundMetric(readIopsMetric.max)}` : ""}${writeThroughputMetric?.max !== undefined ? `, max_write_throughput=${roundMetric(writeThroughputMetric.max)}` : ""}${readThroughputMetric?.max !== undefined ? `, max_read_throughput=${roundMetric(readThroughputMetric.max)}` : ""}.`,
    });
  }
  if (
    tempTablesMetric &&
    (tempTablesMetric.max ?? 0) > 0 &&
    tmpDiskDigests.length > 0
  ) {
    rootCauseCandidates.push({
      code: "storage_pressure_tmp_table_metric_confirmed",
      title: "Temporary table workload is visible in SQL and CES metrics",
      confidence: "medium",
      rationale: `Statement digests show temporary disk usage and CES temp-table metrics were non-zero; ${metricSummaryText(tempTablesMetric)}.`,
    });
  }
  if (rootCauseCandidates.length === 0) {
    rootCauseCandidates.push({
      code: "storage_pressure_snapshot_collected",
      title:
        "Storage evidence was collected but no dominant pressure signal stood out",
      confidence: "low",
      rationale:
        "Local table size and statement digest summaries were collected, but temporary disk spill, scan pressure, and large-table thresholds were not crossed.",
    });
  }

  const leadDigest = relevantDigests[0];
  const suspiciousSqls = relevantDigests
    .filter(
      (row) =>
        (row.avgTmpDiskTables ?? 0) > 0 ||
        (row.avgTmpTables ?? 0) > 0 ||
        (row.avgSortRows ?? 0) >= 1_000 ||
        (row.noIndexUsedCount ?? 0) > 0 ||
        (row.selectScanCount ?? 0) > 0 ||
        (row.avgRowsExamined ?? 0) >= 10_000,
    )
    .slice(0, maxCandidates)
    .map((row) => ({
      sqlHash: row.querySampleText
        ? sqlHash(normalizeSql(row.querySampleText))
        : undefined,
      digestText: row.digestText,
      reason: `Statement digest shows storage-relevant work${row.avgTmpDiskTables !== undefined ? `; avg_tmp_disk_tables=${row.avgTmpDiskTables}` : ""}${row.avgTmpTables !== undefined ? `, avg_tmp_tables=${row.avgTmpTables}` : ""}${row.avgSortRows !== undefined ? `, avg_sort_rows=${row.avgSortRows}` : ""}${row.avgRowsExamined !== undefined ? `, avg_rows_examined=${row.avgRowsExamined}` : ""}.`,
    }));
  const suspiciousTables = tableRows.slice(0, maxCandidates).map((row) => {
    const qualifiedTable = [row.schemaName, row.tableName]
      .filter(Boolean)
      .join(".");
    return {
      table: qualifiedTable || row.tableName || diagnosisInput.table || "unknown",
      reason: diagnosisInput.table
        ? "Provided as the storage-pressure focus and matched against local table-size metadata."
        : `Top local table by storage footprint${row.totalMb !== undefined ? `; total_mb=${row.totalMb}` : ""}${row.rowCountEstimate !== undefined ? `, row_count_estimate=${row.rowCountEstimate}` : ""}.`,
    };
  });

  const keyFindings = [
    `Scope requested: ${diagnosisInput.scope ?? "instance"}.`,
    diagnosisInput.table
      ? `Table focus provided: ${diagnosisInput.table}.`
      : "No table focus was provided.",
    relevantDigests.length > 0
      ? `Collected ${relevantDigests.length} statement digest rows for storage-pressure correlation.`
      : "No statement digest rows were available for storage-pressure correlation.",
    tableRows.length > 0
      ? `Collected ${tableRows.length} table-size rows from information_schema.TABLES.`
      : "No table-size rows were available from information_schema.TABLES.",
  ];
  if (tmpDiskDigests.length > 0) {
    keyFindings.push(
      `${tmpDiskDigests.length} digest rows show temporary disk table usage.`,
    );
  }
  if (scanDigests.length > 0) {
    keyFindings.push(
      `${scanDigests.length} digest rows show scan-heavy execution.`,
    );
  }
  if (leadDigest?.digestText) {
    keyFindings.push(`Lead storage-relevant digest: ${leadDigest.digestText}.`);
  }
  if (storageUsedMetric) {
    keyFindings.push(
      `CES storage used size: ${metricSummaryText(storageUsedMetric)}.`,
    );
  }
  if (writeDelayMetric) {
    keyFindings.push(
      `CES storage write delay: ${metricSummaryText(writeDelayMetric)}.`,
    );
  }
  if (readDelayMetric) {
    keyFindings.push(
      `CES storage read delay: ${metricSummaryText(readDelayMetric)}.`,
    );
  }
  if (writeIopsMetric || readIopsMetric) {
    keyFindings.push(
      `CES IOPS: write=${writeIopsMetric ? metricSummaryText(writeIopsMetric) : "n/a"}; read=${readIopsMetric ? metricSummaryText(readIopsMetric) : "n/a"}.`,
    );
  }

  const leadSlowQueryInput = buildSlowQueryNextToolInput(
    {
      sqlHash: leadDigest?.querySampleText
        ? sqlHash(normalizeSql(leadDigest.querySampleText))
        : undefined,
      digestText: leadDigest?.digestText,
      sampleSql: leadDigest?.querySampleText,
    },
    diagnosisInput,
    "Inspect the lead storage-relevant digest with plan and runtime counters before tuning only table footprint or instance-level storage settings.",
  );
  if (leadSlowQueryInput) {
    recommendedNextTools.add("diagnose_slow_query");
    nextToolInputs.push(leadSlowQueryInput);
  }
  if (
    relevantDigests.length > 1 ||
    (writeDelayMetric?.max ?? 0) >= 50 ||
    (readDelayMetric?.max ?? 0) >= 50 ||
    (writeIopsMetric?.max ?? 0) >= 1000 ||
    (readIopsMetric?.max ?? 0) >= 1000 ||
    (writeThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024 ||
    (readThroughputMetric?.max ?? 0) >= 50 * 1024 * 1024
  ) {
    recommendedNextTools.add("find_top_slow_sql");
    nextToolInputs.push(
      buildFindTopSlowSqlNextToolInput(
        { sortBy: "total_latency", topN: 5 },
        diagnosisInput,
        "Rank the broader slow-SQL set to confirm whether the lead digest is representative of overall storage pressure.",
      ),
    );
  }
  if (
    diagnosisInput.scope === "table" ||
    diagnosisInput.table ||
    largeTables.length > 0
  ) {
    recommendedNextTools.add("diagnose_db_hotspot");
    nextToolInputs.push(
      buildDbHotspotNextToolInput(
        { scope: "table" },
        diagnosisInput,
        "Correlate the suspected table footprint with current table-level hotspots before changing only storage capacity or purge policy.",
      ),
    );
  }

  const recommendedActions = [
    "Use diagnose_slow_query on the lead storage-relevant SQL digest to inspect plan shape and runtime counters.",
    "Review predicates, indexes, ORDER BY, and GROUP BY clauses for digests with scan, filesort, or temporary-table signals.",
  ];
  if (tmpDiskDigests.length > 0) {
    recommendedActions.push(
      "Reduce temporary disk tables by supporting grouping/sorting with indexes or reducing intermediate row width.",
    );
  }
  if (largeTables.length > 0) {
    recommendedActions.push(
      "Review the largest table footprints and purge/archive strategy before tuning only individual SQL statements.",
    );
  }
  if ((writeDelayMetric?.max ?? 0) >= 50 || (readDelayMetric?.max ?? 0) >= 50) {
    recommendedActions.push(
      "Correlate SQL spill/scan candidates with CES storage read/write latency before changing only query plans.",
    );
  }

  const severity: DiagnosticSeverity =
    (writeDelayMetric?.max ?? 0) >= 100 ||
    (readDelayMetric?.max ?? 0) >= 100 ||
    tmpDiskDigests.length > 0 ||
    scanDigests.some((row) => (row.avgRowsExamined ?? 0) >= 100_000)
      ? "warning"
      : rootCauseCandidates[0]?.code === "storage_pressure_snapshot_collected"
        ? "info"
        : "warning";

  return {
    tool: "diagnose_storage_pressure",
    status:
      relevantDigests.length > 0 || tableRows.length > 0 || metrics.length > 0
        ? "ok"
        : "inconclusive",
    severity,
    summary: withDatasourceSummary(
      rootCauseCandidates[0]?.code === "storage_pressure_snapshot_collected"
        ? "Storage-pressure diagnosis collected local evidence without isolating a dominant pressure signal"
        : "Storage-pressure diagnosis collected local SQL and table metadata evidence",
      ctx.datasource,
    ),
    diagnosisWindow: {
      from: diagnosisInput.timeRange?.from,
      to: diagnosisInput.timeRange?.to,
      relative: diagnosisInput.timeRange?.relative,
    },
    rootCauseCandidates: rootCauseCandidates.slice(0, maxCandidates),
    keyFindings,
    suspiciousEntities:
      suspiciousSqls.length > 0 || suspiciousTables.length > 0
        ? {
            sqls: suspiciousSqls.length > 0 ? suspiciousSqls : undefined,
            tables: suspiciousTables.length > 0 ? suspiciousTables : undefined,
          }
        : undefined,
    evidence: [
      {
        source: "statement_digest",
        title: "Statement digest storage counters",
        summary:
          relevantDigests.length > 0
            ? `Collected ${relevantDigests.length} digest rows; tmp_disk=${tmpDiskDigests.length}, scan_heavy=${scanDigests.length}, sort_or_tmp=${Math.max(sortDigests.length, tmpTableDigests.length)}.`
            : "No matching rows were returned from performance_schema.events_statements_summary_by_digest.",
      },
      {
        source: "table_storage",
        title: "Table storage footprint",
        summary:
          tableRows.length > 0
            ? `Collected ${tableRows.length} rows from information_schema.TABLES; largest=${[tableRows[0]?.schemaName, tableRows[0]?.tableName].filter(Boolean).join(".") || "n/a"}${tableRows[0]?.totalMb !== undefined ? ` (${tableRows[0].totalMb} MB)` : ""}.`
            : "No matching table-size rows were returned from information_schema.TABLES.",
      },
      ...metricEvidence,
    ],
    recommendedActions: [...new Set(recommendedActions)],
    recommendedNextTools: [...recommendedNextTools],
    nextToolInputs: dedupeNextToolInputs(nextToolInputs).slice(0, 5),
    limitations: [
      ...metricsSourceLimitation(metricsSource),
      "Statement digest counters are cumulative within performance_schema retention and are not yet filtered by the requested time_range.",
    ],
  };
}
