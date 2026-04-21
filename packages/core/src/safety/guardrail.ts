import type { DatabaseEngine } from "../auth/sql-profile-loader.js";
import type { SessionContext } from "../context/session-context.js";
import { createSqlParser, type SqlParser } from "./parser/index.js";
import { classifySql } from "./sql-classifier.js";
import {
  validateStaticRules,
  validateToolScope,
  type RiskLevel,
  type ValidationResult,
} from "./sql-validator.js";

export interface GuardrailRuntimeLimits {
  readonly: boolean;
  timeoutMs: number;
  maxRows: number;
  maxColumns: number;
  maxFieldChars: number;
}

export interface GuardrailDecision {
  action: "allow" | "confirm" | "block";
  riskLevel: RiskLevel;
  reasonCodes: string[];
  riskHints: string[];
  normalizedSql: string;
  sqlHash: string;
  requiresExplain: boolean;
  requiresConfirmation: boolean;
  runtimeLimits: GuardrailRuntimeLimits;
}

export interface InspectInput {
  toolName: string;
  sql: string;
  context: SessionContext;
}

export interface Guardrail {
  inspect(input: InspectInput): Promise<GuardrailDecision>;
}

export type GuardrailOptions = {
  parserFactory?: (engine: DatabaseEngine) => SqlParser;
};

function dedupeCaseInsensitive(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

function pickHigherRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    blocked: 3,
  };
  return order[b] > order[a] ? b : a;
}

function pickDominantAction(current: GuardrailDecision["action"], next: ValidationResult["action"]) {
  if (current === "block" || next === "block") {
    return "block";
  }
  if (current === "confirm" || next === "confirm") {
    return "confirm";
  }
  return "allow";
}

function buildBaseDecision(
  input: InspectInput,
  normalizedSql: string,
  sqlHash: string,
  action: GuardrailDecision["action"],
  riskLevel: RiskLevel,
  reasonCodes: string[],
  riskHints: string[],
  requiresExplain: boolean,
): GuardrailDecision {
  const readonlyByTool =
    input.toolName === "execute_readonly_sql" || input.toolName === "explain_sql";
  const readonly = input.context.limits.readonly || readonlyByTool;

  return {
    action,
    riskLevel,
    reasonCodes: dedupeCaseInsensitive(reasonCodes),
    riskHints: dedupeCaseInsensitive(riskHints),
    normalizedSql,
    sqlHash,
    requiresExplain,
    requiresConfirmation: action === "confirm",
    runtimeLimits: {
      readonly,
      timeoutMs: input.context.limits.timeoutMs,
      maxRows: input.context.limits.maxRows,
      maxColumns: input.context.limits.maxColumns,
      maxFieldChars: input.context.limits.maxFieldChars ?? 2048,
    },
  };
}

function mergeDecision(
  input: InspectInput,
  normalizedSql: string,
  sqlHash: string,
  validations: ValidationResult[],
  requiresExplain: boolean,
): GuardrailDecision {
  let action: GuardrailDecision["action"] = "allow";
  let riskLevel: RiskLevel = "low";
  const reasonCodes: string[] = [];
  const riskHints: string[] = [];

  for (const validation of validations) {
    action = pickDominantAction(action, validation.action);
    riskLevel = pickHigherRisk(riskLevel, validation.riskLevel);
    reasonCodes.push(...validation.reasonCodes);
    riskHints.push(...validation.riskHints);
  }

  return buildBaseDecision(
    input,
    normalizedSql,
    sqlHash,
    action,
    riskLevel,
    reasonCodes,
    riskHints,
    requiresExplain,
  );
}

export class GuardrailImpl implements Guardrail {
  private readonly parserFactory: (engine: DatabaseEngine) => SqlParser;

  constructor(options: GuardrailOptions = {}) {
    this.parserFactory = options.parserFactory ?? ((engine) => createSqlParser(engine));
  }

  async inspect(input: InspectInput): Promise<GuardrailDecision> {
    const parser = this.parserFactory(input.context.engine);
    const normalized = parser.normalize(input.sql);
    const parseResult = parser.parse(normalized.normalizedSql);

    if (!parseResult.ok) {
      return buildBaseDecision(
        input,
        normalized.normalizedSql,
        normalized.sqlHash,
        "block",
        "blocked",
        ["G001"],
        [`SQL parse failed: ${parseResult.error.message}`],
        false,
      );
    }

    const cls = classifySql(parseResult.ast, normalized, input.context.engine);
    const d1 = validateToolScope(input.toolName, cls);
    if (d1.action === "block") {
      return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1], false);
    }

    const d2 = validateStaticRules(cls);
    if (d2.action === "block") {
      return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1, d2], false);
    }

    return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1, d2], false);
  }
}

export function createGuardrail(options: GuardrailOptions = {}): Guardrail {
  return new GuardrailImpl(options);
}
