import type { DatabaseEngine } from "../auth/sql-profile-loader.js";
import type { SessionContext } from "../context/session-context.js";
import type { SchemaIntrospector } from "../schema/introspector.js";
import { type SqlParser } from "./parser/index.js";
import { type ExplainRiskSummary, type RiskLevel } from "./sql-validator.js";
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
export declare class GuardrailImpl implements Guardrail {
    private readonly schemaIntrospector?;
    private readonly executor?;
    private readonly parserFactory;
    constructor(options?: GuardrailOptions);
    inspect(input: InspectInput): Promise<GuardrailDecision>;
}
export declare function createGuardrail(options?: GuardrailOptions): Guardrail;
