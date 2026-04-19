import type { DatabaseEngine } from "../auth/sql-profile-loader.js";
import type { SessionContext } from "../context/session-context.js";
import type { SchemaIntrospector, TableSchema } from "../schema/introspector.js";
import { createSqlParser, type SqlParser } from "./parser/index.js";
import { classifySql, type SqlClassification } from "./sql-classifier.js";
import {
  validateCost,
  validateSchemaAware,
  validateStaticRules,
  validateToolScope,
  type ExplainRiskSummary,
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

export interface GuardrailExecutor {
  explainForGuardrail(sql: string, ctx: SessionContext): Promise<ExplainRiskSummary>;
}

export interface Guardrail {
  inspect(input: InspectInput): Promise<GuardrailDecision>;
}

export type GuardrailOptions = {
  schemaIntrospector?: Pick<SchemaIntrospector, "describeTable">;
  executor?: GuardrailExecutor;
  parserFactory?: (engine: DatabaseEngine) => SqlParser;
};

type ParsedTableRef = {
  database?: string;
  table: string;
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

function parseTableRef(tableRef: string, defaultDatabase?: string): ParsedTableRef | undefined {
  const trimmed = tableRef.trim();
  if (!trimmed) {
    return undefined;
  }

  const dotIndex = trimmed.indexOf(".");
  if (dotIndex <= 0) {
    return {
      database: defaultDatabase,
      table: trimmed,
    };
  }

  return {
    database: trimmed.slice(0, dotIndex),
    table: trimmed.slice(dotIndex + 1),
  };
}

function shouldExplain(cls: SqlClassification, validations: ValidationResult[]): boolean {
  const hasBlock = validations.some((result) => result.action === "block");
  if (hasBlock) {
    return false;
  }

  if (cls.statementType === "update" || cls.statementType === "delete" || cls.statementType === "alter") {
    return true;
  }

  if (cls.statementType === "select") {
    if (!cls.hasLimit || cls.hasJoin || cls.hasSubquery || cls.hasOrderBy || cls.hasAggregate) {
      return true;
    }
  }

  return false;
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

async function loadSchemaSnapshot(
  introspector: Pick<SchemaIntrospector, "describeTable"> | undefined,
  ctx: SessionContext,
  tableRefs: string[],
): Promise<Map<string, TableSchema>> {
  const snapshot = new Map<string, TableSchema>();
  if (!introspector || tableRefs.length === 0) {
    return snapshot;
  }

  const parsed = dedupeCaseInsensitive(tableRefs)
    .map((tableRef) => parseTableRef(tableRef, ctx.database))
    .filter((entry): entry is ParsedTableRef => entry !== undefined && !!entry.table);

  await Promise.all(
    parsed.map(async (tableRef) => {
      if (!tableRef.database) {
        return;
      }
      try {
        const schema = await introspector.describeTable(ctx, tableRef.database, tableRef.table);
        snapshot.set(`${schema.database}.${schema.table}`.toLowerCase(), schema);
      } catch {
        // Ignore per-table load failures; validator will report missing table/column from snapshot.
      }
    }),
  );

  return snapshot;
}

export class GuardrailImpl implements Guardrail {
  private readonly schemaIntrospector?: Pick<SchemaIntrospector, "describeTable">;
  private readonly executor?: GuardrailExecutor;
  private readonly parserFactory: (engine: DatabaseEngine) => SqlParser;

  constructor(options: GuardrailOptions = {}) {
    this.schemaIntrospector = options.schemaIntrospector;
    this.executor = options.executor;
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

    const schemaSnapshot = await loadSchemaSnapshot(
      this.schemaIntrospector,
      input.context,
      cls.referencedTables,
    );
    const d3 = validateSchemaAware(cls, schemaSnapshot);
    if (d3.action === "block") {
      return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, [d1, d2, d3], false);
    }

    const preCostValidations = [d1, d2, d3];
    const requiresExplain = shouldExplain(cls, preCostValidations);

    let d4: ValidationResult | undefined;
    if (requiresExplain && this.executor) {
      const explainSummary = await this.executor.explainForGuardrail(input.sql, input.context);
      d4 = validateCost(cls, explainSummary);
    } else if (requiresExplain && !this.executor) {
      d4 = {
        action: "confirm",
        riskLevel: "high",
        reasonCodes: ["G002"],
        riskHints: [
          "Explain summary is required but executor is unavailable.",
          "Fallback to confirmation before execution.",
        ],
      };
    }

    const validations = d4 ? [...preCostValidations, d4] : preCostValidations;
    return mergeDecision(input, normalized.normalizedSql, normalized.sqlHash, validations, requiresExplain);
  }
}

export function createGuardrail(options: GuardrailOptions = {}): Guardrail {
  return new GuardrailImpl(options);
}
