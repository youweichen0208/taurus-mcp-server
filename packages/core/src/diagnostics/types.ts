export type DiagnosticToolName =
  | "diagnose_slow_query"
  | "diagnose_connection_spike"
  | "diagnose_lock_contention"
  | "diagnose_replication_lag"
  | "diagnose_storage_pressure";

export type DiagnosticStatus = "ok" | "inconclusive" | "not_applicable";
export type DiagnosticSeverity = "info" | "warning" | "high" | "critical";
export type DiagnosticEvidenceLevel = "basic" | "standard" | "full";
export type DiagnosticConfidence = "low" | "medium" | "high";

export interface DiagnosisWindow {
  from?: string;
  to?: string;
  relative?: string;
}

export interface DiagnosticBaseInput {
  datasource?: string;
  database?: string;
  timeRange?: DiagnosisWindow;
  evidenceLevel?: DiagnosticEvidenceLevel;
  includeRawEvidence?: boolean;
  maxCandidates?: number;
}

export interface DiagnoseSlowQueryInput extends DiagnosticBaseInput {
  sql?: string;
  sqlHash?: string;
  digestText?: string;
}

export interface DiagnoseConnectionSpikeInput extends DiagnosticBaseInput {
  user?: string;
  clientHost?: string;
  compareBaseline?: boolean;
}

export interface DiagnoseLockContentionInput extends DiagnosticBaseInput {
  table?: string;
  blockerSessionId?: string;
}

export interface DiagnoseReplicationLagInput extends DiagnosticBaseInput {
  replicaId?: string;
  channel?: string;
}

export interface DiagnoseStoragePressureInput extends DiagnosticBaseInput {
  scope?: "instance" | "database" | "table";
  table?: string;
}

export interface DiagnosticRootCauseCandidate {
  code: string;
  title: string;
  confidence: DiagnosticConfidence;
  rationale: string;
}

export interface DiagnosticSuspiciousSql {
  sqlHash?: string;
  digestText?: string;
  reason: string;
}

export interface DiagnosticSuspiciousSession {
  sessionId?: string;
  user?: string;
  state?: string;
  reason: string;
}

export interface DiagnosticSuspiciousTable {
  table: string;
  reason: string;
}

export interface DiagnosticSuspiciousUser {
  user: string;
  clientHost?: string;
  reason: string;
}

export interface DiagnosticSuspiciousEntities {
  sqls?: DiagnosticSuspiciousSql[];
  sessions?: DiagnosticSuspiciousSession[];
  tables?: DiagnosticSuspiciousTable[];
  users?: DiagnosticSuspiciousUser[];
}

export interface DiagnosticEvidenceItem {
  source: string;
  title: string;
  summary: string;
  rawRef?: string;
}

export interface DiagnosticResult {
  tool: DiagnosticToolName;
  status: DiagnosticStatus;
  severity: DiagnosticSeverity;
  summary: string;
  diagnosisWindow: DiagnosisWindow;
  rootCauseCandidates: DiagnosticRootCauseCandidate[];
  keyFindings: string[];
  suspiciousEntities?: DiagnosticSuspiciousEntities;
  evidence: DiagnosticEvidenceItem[];
  recommendedActions: string[];
  limitations?: string[];
}

export interface PlaceholderDiagnosticOptions {
  summary: string;
  candidateTitle: string;
  candidateRationale: string;
  keyFindings?: string[];
  suspiciousEntities?: DiagnosticSuspiciousEntities;
  recommendedActions?: string[];
  limitations?: string[];
  evidence?: DiagnosticEvidenceItem[];
  status?: DiagnosticStatus;
  severity?: DiagnosticSeverity;
}

export function createPlaceholderDiagnosticResult(
  tool: DiagnosticToolName,
  input: DiagnosticBaseInput,
  options: PlaceholderDiagnosticOptions,
): DiagnosticResult {
  return {
    tool,
    status: options.status ?? "inconclusive",
    severity: options.severity ?? "info",
    summary: options.summary,
    diagnosisWindow: {
      from: input.timeRange?.from,
      to: input.timeRange?.to,
      relative: input.timeRange?.relative,
    },
    rootCauseCandidates: [
      {
        code: `${tool}_pending`,
        title: options.candidateTitle,
        confidence: "low",
        rationale: options.candidateRationale,
      },
    ],
    keyFindings: options.keyFindings ?? [
      "The diagnostic contract is available, but evidence collectors have not been wired yet.",
      "No live control-plane or data-plane evidence was collected in this run.",
    ],
    suspiciousEntities: options.suspiciousEntities,
    evidence: options.evidence ?? [
      {
        source: "diagnostics_scaffold",
        title: "Diagnostic scaffold active",
        summary: "Typed inputs, outputs, and engine entrypoints are in place, but collectors and analyzers are pending.",
      },
    ],
    recommendedActions: options.recommendedActions ?? [
      "Implement the required collectors before relying on this tool for production diagnosis.",
    ],
    limitations: options.limitations ?? [
      "This diagnostic currently returns a scaffolded result instead of live evidence-backed analysis.",
    ],
  };
}
