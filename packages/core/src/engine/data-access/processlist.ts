import type { SessionContext } from "../../context/session-context.js";
import type { DiagnoseLockContentionInput, DiagnoseStoragePressureInput, FindTopSlowSqlInput } from "../../diagnostics/types.js";
import type { QueryResult } from "../../executor/sql-executor.js";
import type { ShowLockWaitsInput, ShowProcesslistInput, TaurusDBEngine } from "../../engine.js";
import {
  clampInteger,
  digestMatchScore,
  escapeLikePrefix,
  extractSqlTableNameHints,
  lockEvidenceRowLimit,
  parseDeadlockSummary,
  parseMetadataLockRows,
  parseStatementDigestRows,
  parseStatementWaitEventRows,
  parseTableStorageRows,
  quoteLiteral,
  topSlowSqlOrderBy,
  type DeadlockSummary,
  type MetadataLockRow,
  type StatementDigestRow,
  type StatementWaitEventRow,
  type TableStorageRow,
} from "../helpers.js";

export async function showProcesslist(
  engine: TaurusDBEngine,
  input: ShowProcesslistInput,
  ctx: SessionContext,
): Promise<QueryResult> {
    const maxRows = clampInteger(input.maxRows, 20, 1, 100);
    const minTimeSeconds = clampInteger(input.minTimeSeconds, 0, 0, 86_400);
    const includeIdle = input.includeIdle === true;
    const includeSystem = input.includeSystem === true;
    const includeInfo = input.includeInfo === true;
    const infoMaxChars = clampInteger(input.infoMaxChars, 256, 32, 2048);

    const selectedColumns = [
      "ID AS session_id",
      "USER AS user",
      "HOST AS host",
      "DB AS database_name",
      "COMMAND AS command",
      "TIME AS time_seconds",
      "STATE AS state",
    ];
    if (includeInfo) {
      selectedColumns.push("INFO AS info_preview");
    }

    const whereClauses: string[] = [];
    if (!includeIdle) {
      whereClauses.push("COMMAND <> 'Sleep'");
    }
    if (!includeSystem) {
      whereClauses.push("USER <> 'system user'");
    }
    if (input.user) {
      whereClauses.push(`USER = ${quoteLiteral(input.user)}`);
    }
    if (input.host) {
      whereClauses.push(
        `HOST LIKE ${quoteLiteral(`${escapeLikePrefix(input.host)}%`)} ESCAPE '\\'`,
      );
    }
    if (input.sessionDatabase) {
      whereClauses.push(`DB = ${quoteLiteral(input.sessionDatabase)}`);
    }
    if (input.command) {
      whereClauses.push(`COMMAND = ${quoteLiteral(input.command)}`);
    }
    if (minTimeSeconds > 0) {
      whereClauses.push(`TIME >= ${minTimeSeconds}`);
    }

    const sql = `
      SELECT ${selectedColumns.join(", ")}
      FROM information_schema.PROCESSLIST
      ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY TIME DESC, ID DESC
      LIMIT ${maxRows}
    `.trim();

    return engine.executor.executeReadonly(sql, ctx, {
      maxRows,
      maxColumns: selectedColumns.length,
      maxFieldChars: includeInfo ? infoMaxChars : 256,
      timeoutMs: ctx.limits.timeoutMs,
    });
  }
