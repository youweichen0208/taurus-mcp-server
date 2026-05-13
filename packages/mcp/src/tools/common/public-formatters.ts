import type {
  DbHotspotResult,
  DataSourceInfo,
  DatabaseInfo,
  DiagnosticResult,
  EnhancedExplainResult,
  ExplainResult,
  FeatureMatrix,
  FindTopSlowSqlResult,
  GuardrailDecision,
  KernelInfo,
  MutationResult,
  QueryResult,
  ServiceLatencyResult,
  TableInfo,
  TableSchema,
} from "@huaweicloud/taurusdb-core";

export function toPublicDataSourceInfo(info: DataSourceInfo) {
  return {
    name: info.name,
    engine: info.engine,
    host: info.host,
    port: info.port,
    database: info.database,
    has_mutation_user: info.hasMutationUser,
    pool_size: info.poolSize,
    is_default: info.isDefault,
  };
}

export function toPublicDatabaseInfo(info: DatabaseInfo) {
  return {
    name: info.name,
    owner: info.owner,
    comment: info.comment,
  };
}

export function toPublicTableInfo(info: TableInfo) {
  return {
    database: info.database,
    name: info.name,
    type: info.type,
    comment: info.comment,
    row_count_estimate: info.rowCountEstimate,
  };
}

export function toPublicTableSchema(schema: TableSchema) {
  return {
    database: schema.database,
    table: schema.table,
    columns: schema.columns.map((column) => ({
      name: column.name,
      data_type: column.dataType,
      nullable: column.nullable,
      default_value: column.defaultValue,
      max_length: column.maxLength,
      is_primary_key: column.isPrimaryKey,
      is_indexed: column.isIndexed,
      comment: column.comment,
    })),
    indexes: schema.indexes.map((index) => ({
      name: index.name,
      columns: index.columns,
      unique: index.unique,
      type: index.type,
    })),
    primary_key: schema.primaryKey,
    engine_hints: schema.engineHints
      ? {
          likely_time_columns: schema.engineHints.likelyTimeColumns,
          likely_filter_columns: schema.engineHints.likelyFilterColumns,
          sensitive_columns: schema.engineHints.sensitiveColumns,
        }
      : undefined,
    comment: schema.comment,
    row_count_estimate: schema.rowCountEstimate,
  };
}

export function toPublicQueryResult(result: QueryResult) {
  return {
    columns: result.columns,
    rows: result.rows,
    row_count: result.rowCount,
    original_row_count: result.originalRowCount,
    truncated: result.truncated,
    row_truncated: result.rowTruncated,
    column_truncated: result.columnTruncated,
    field_truncated: result.fieldTruncated,
    redacted_columns: result.redactedColumns,
    dropped_columns: result.droppedColumns,
    truncated_columns: result.truncatedColumns,
  };
}

export function toPublicMutationResult(result: MutationResult) {
  return {
    affected_rows: result.affectedRows,
  };
}

export function toPublicGuardrailDecision(decision: GuardrailDecision) {
  return {
    action: decision.action,
    risk_level: decision.riskLevel,
    reason_codes: decision.reasonCodes,
    risk_hints: decision.riskHints,
    requires_explain: decision.requiresExplain,
    requires_confirmation: decision.requiresConfirmation,
    sql_hash: decision.sqlHash,
    runtime_limits: {
      readonly: decision.runtimeLimits.readonly,
      timeout_ms: decision.runtimeLimits.timeoutMs,
      max_rows: decision.runtimeLimits.maxRows,
      max_columns: decision.runtimeLimits.maxColumns,
      max_field_chars: decision.runtimeLimits.maxFieldChars,
    },
  };
}

export function toPublicExplainResult(
  result: ExplainResult,
  decision: GuardrailDecision,
) {
  return {
    plan: result.plan,
    risk_summary: {
      full_table_scan_likely: result.riskSummary.fullTableScanLikely,
      index_hit_likely: result.riskSummary.indexHitLikely,
      estimated_rows: result.riskSummary.estimatedRows,
      uses_temp_structure: result.riskSummary.usesTempStructure,
      uses_filesort: result.riskSummary.usesFilesort,
      risk_hints: result.riskSummary.riskHints,
    },
    recommendations: result.recommendations,
    guardrail: toPublicGuardrailDecision(decision),
  };
}

export function toPublicKernelInfo(info: KernelInfo) {
  return {
    is_taurusdb: info.isTaurusDB,
    kernel_version: info.kernelVersion,
    mysql_compat: info.mysqlCompat,
    instance_spec_hint: info.instanceSpecHint,
    raw_version: info.rawVersion,
  };
}

function toPublicFeatureStatus(status: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(status).map(([key, value]) => {
      if (key === "minVersion") {
        return ["min_version", value];
      }
      return [key, value];
    }),
  );
}

const HIDDEN_PUBLIC_FEATURES = new Set([
  "statement_outline",
  "column_compression",
  "multi_tenant",
  "partition_mdl",
  "hot_row_update",
]);

export function toPublicFeatureMatrix(features: FeatureMatrix) {
  return Object.fromEntries(
    Object.entries(features)
      .filter(([name]) => !HIDDEN_PUBLIC_FEATURES.has(name))
      .map(([name, status]) => [name, toPublicFeatureStatus(status)]),
  );
}

export function toPublicEnhancedExplainResult(
  result: EnhancedExplainResult,
  decision: GuardrailDecision,
) {
  return {
    standard_plan: toPublicExplainResult(result.standardPlan, decision),
    tree_plan: result.treePlan,
    taurus_hints: {
      ndp_pushdown: {
        condition: result.taurusHints.ndpPushdown.condition,
        columns: result.taurusHints.ndpPushdown.columns,
        aggregate: result.taurusHints.ndpPushdown.aggregate,
        blocked_reason: result.taurusHints.ndpPushdown.blockedReason,
      },
      parallel_query: {
        would_enable: result.taurusHints.parallelQuery.wouldEnable,
        estimated_degree: result.taurusHints.parallelQuery.estimatedDegree,
        blocked_reason: result.taurusHints.parallelQuery.blockedReason,
      },
      offset_pushdown: result.taurusHints.offsetPushdown,
    },
    feature_explanations: {
      ndp_pushdown: {
        matched: result.featureExplanations.ndpPushdown.matched,
        meaning: result.featureExplanations.ndpPushdown.meaning,
        why_triggered: result.featureExplanations.ndpPushdown.whyTriggered,
        expected_benefit: result.featureExplanations.ndpPushdown.expectedBenefit,
      },
      parallel_query: {
        matched: result.featureExplanations.parallelQuery.matched,
        meaning: result.featureExplanations.parallelQuery.meaning,
        why_triggered: result.featureExplanations.parallelQuery.whyTriggered,
        expected_benefit: result.featureExplanations.parallelQuery.expectedBenefit,
      },
      offset_pushdown: {
        matched: result.featureExplanations.offsetPushdown.matched,
        meaning: result.featureExplanations.offsetPushdown.meaning,
        why_triggered: result.featureExplanations.offsetPushdown.whyTriggered,
        expected_benefit: result.featureExplanations.offsetPushdown.expectedBenefit,
      },
    },
    optimization_suggestions: result.optimizationSuggestions,
  };
}

export function toPublicDiagnosticResult(result: DiagnosticResult) {
  return {
    tool: result.tool,
    status: result.status,
    severity: result.severity,
    summary: result.summary,
    diagnosis_window: {
      from: result.diagnosisWindow.from,
      to: result.diagnosisWindow.to,
      relative: result.diagnosisWindow.relative,
    },
    root_cause_candidates: result.rootCauseCandidates.map(
      (candidate: DiagnosticResult["rootCauseCandidates"][number]) => ({
        code: candidate.code,
        title: candidate.title,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
      }),
    ),
    key_findings: result.keyFindings,
    suspicious_entities: result.suspiciousEntities
      ? {
          sqls: result.suspiciousEntities.sqls?.map(
            (
              item: NonNullable<
                NonNullable<DiagnosticResult["suspiciousEntities"]>["sqls"]
              >[number],
            ) => ({
              sql_hash: item.sqlHash,
              digest_text: item.digestText,
              reason: item.reason,
            }),
          ),
          sessions: result.suspiciousEntities.sessions?.map(
            (
              item: NonNullable<
                NonNullable<DiagnosticResult["suspiciousEntities"]>["sessions"]
              >[number],
            ) => ({
              session_id: item.sessionId,
              user: item.user,
              state: item.state,
              reason: item.reason,
            }),
          ),
          tables: result.suspiciousEntities.tables?.map(
            (
              item: NonNullable<
                NonNullable<DiagnosticResult["suspiciousEntities"]>["tables"]
              >[number],
            ) => ({
              table: item.table,
              reason: item.reason,
            }),
          ),
          users: result.suspiciousEntities.users?.map(
            (
              item: NonNullable<
                NonNullable<DiagnosticResult["suspiciousEntities"]>["users"]
              >[number],
            ) => ({
              user: item.user,
              client_host: item.clientHost,
              reason: item.reason,
            }),
          ),
        }
      : undefined,
    evidence: result.evidence.map(
      (item: DiagnosticResult["evidence"][number]) => ({
        source: item.source,
        title: item.title,
        summary: item.summary,
        raw_ref: item.rawRef,
      }),
    ),
    recommended_actions: result.recommendedActions,
    recommended_next_tools: result.recommendedNextTools,
    next_tool_inputs: result.nextToolInputs?.map((item) => ({
      tool: item.tool,
      input: item.input,
      rationale: item.rationale,
    })),
    limitations: result.limitations,
  };
}

export function toPublicTopSlowSqlResult(result: FindTopSlowSqlResult) {
  return {
    tool: result.tool,
    status: result.status,
    summary: result.summary,
    diagnosis_window: {
      from: result.diagnosisWindow.from,
      to: result.diagnosisWindow.to,
      relative: result.diagnosisWindow.relative,
    },
    top_sqls: result.topSqls.map((item) => ({
      sql_hash: item.sqlHash,
      digest_text: item.digestText,
      sample_sql: item.sampleSql,
      avg_latency_ms: item.avgLatencyMs,
      total_latency_ms: item.totalLatencyMs,
      exec_count: item.execCount,
      avg_lock_time_ms: item.avgLockTimeMs,
      avg_rows_examined: item.avgRowsExamined,
      evidence_sources: item.evidenceSources,
      recommendation: item.recommendation,
    })),
    evidence: result.evidence.map((item) => ({
      source: item.source,
      title: item.title,
      summary: item.summary,
      raw_ref: item.rawRef,
    })),
    limitations: result.limitations,
  };
}

export function toPublicServiceLatencyResult(result: ServiceLatencyResult) {
  return {
    tool: result.tool,
    status: result.status,
    summary: result.summary,
    diagnosis_window: {
      from: result.diagnosisWindow.from,
      to: result.diagnosisWindow.to,
      relative: result.diagnosisWindow.relative,
    },
    suspected_category: result.suspectedCategory,
    top_candidates: result.topCandidates.map((item) => ({
      type: item.type,
      title: item.title,
      confidence: item.confidence,
      sql_hash: item.sqlHash,
      digest_text: item.digestText,
      sample_sql: item.sampleSql,
      session_id: item.sessionId,
      table: item.table,
      rationale: item.rationale,
    })),
    evidence: result.evidence.map((item) => ({
      source: item.source,
      title: item.title,
      summary: item.summary,
      raw_ref: item.rawRef,
    })),
    recommended_next_tools: result.recommendedNextTools,
    next_tool_inputs: result.nextToolInputs.map((item) => ({
      tool: item.tool,
      input: item.input,
      rationale: item.rationale,
    })),
    limitations: result.limitations,
  };
}

export function toPublicDbHotspotResult(result: DbHotspotResult) {
  return {
    tool: result.tool,
    status: result.status,
    summary: result.summary,
    diagnosis_window: {
      from: result.diagnosisWindow.from,
      to: result.diagnosisWindow.to,
      relative: result.diagnosisWindow.relative,
    },
    scope: result.scope,
    hotspots: result.hotspots.map((item: DbHotspotResult["hotspots"][number]) => ({
      type: item.type,
      title: item.title,
      confidence: item.confidence,
      sql_hash: item.sqlHash,
      digest_text: item.digestText,
      sample_sql: item.sampleSql,
      session_id: item.sessionId,
      table: item.table,
      rationale: item.rationale,
      evidence_sources: item.evidenceSources,
      recommendation: item.recommendation,
    })),
    evidence: result.evidence.map((item: DbHotspotResult["evidence"][number]) => ({
      source: item.source,
      title: item.title,
      summary: item.summary,
      raw_ref: item.rawRef,
    })),
    recommended_next_tools: result.recommendedNextTools,
    next_tool_inputs: result.nextToolInputs.map((item) => ({
      tool: item.tool,
      input: item.input,
      rationale: item.rationale,
    })),
    limitations: result.limitations,
  };
}
