import type { SessionContext } from "../../../context/session-context.js";
import type {
  DiagnoseLockContentionInput,
  DiagnosticResult,
} from "../../../diagnostics/types.js";
import { withDatasourceSummary } from "../../helpers.js";

export function buildNoMatchingLockContentionResult(
  input: DiagnoseLockContentionInput,
  ctx: SessionContext,
): DiagnosticResult {
  return {
    tool: "diagnose_lock_contention",
    status: "inconclusive",
    severity: "info",
    summary: withDatasourceSummary(
      "No matching InnoDB lock waits were observed for lock-contention diagnosis",
      ctx.datasource,
    ),
    diagnosisWindow: {
      from: input.timeRange?.from,
      to: input.timeRange?.to,
      relative: input.timeRange?.relative,
    },
    rootCauseCandidates: [
      {
        code: "lock_contention_no_matching_waits",
        title: "No matching live lock waits observed",
        confidence: "low",
        rationale:
          "The current InnoDB lock-wait snapshot did not contain rows matching the requested table or blocker-session filters.",
      },
    ],
    keyFindings: [
      input.table
        ? `No current lock waits matched table ${ctx.database ? `${ctx.database}.` : ""}${input.table}.`
        : "No current InnoDB lock waits were returned.",
      input.blockerSessionId
        ? `No current lock waits matched blocker session ${input.blockerSessionId}.`
        : "No blocker session filter was applied.",
    ],
    suspiciousEntities:
      input.table || input.blockerSessionId
        ? {
            sessions: input.blockerSessionId
              ? [
                  {
                    sessionId: input.blockerSessionId,
                    reason:
                      "Provided as the diagnosis focus, but no matching live lock waits were observed in the current snapshot.",
                  },
                ]
              : undefined,
            tables: input.table
              ? [
                  {
                    table: input.table,
                    reason:
                      "Provided as the diagnosis focus, but no matching live lock waits were observed in the current snapshot.",
                  },
                ]
              : undefined,
          }
        : undefined,
    evidence: [
      {
        source: "lock_waits",
        title: "Current InnoDB lock-wait snapshot",
        summary:
          "No matching rows were returned from performance_schema.data_lock_waits for the current snapshot.",
      },
    ],
    recommendedActions: [
      "Rerun the diagnosis while the lock wait is active so the blocker and waiter chain is still visible.",
      "Inspect blocker sessions with show_processlist and widen filters if the contention spans multiple tables or users.",
    ],
    limitations: [
      "This diagnostic currently uses a point-in-time InnoDB lock-wait snapshot only.",
      "No metadata-lock or deadlock-history evidence was available for this run.",
    ],
  };
}
