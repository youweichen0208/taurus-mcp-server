import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { VERSION } from "../version.js";

type CheckStatus = "pass" | "fail" | "pending";

type CheckRecord = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type AcceptanceOptions = {
  report?: string;
  instanceId?: string;
  datasource?: string;
  database?: string;
  adviceSql?: string;
  adviceSnapshotSql?: string;
  restoreRecycleTable?: string;
  restoreDestinationDatabase?: string;
  restoreDestinationTable?: string;
  confirmDisposableRestore: boolean;
  loginTimeoutSeconds: number;
};

type ToolResult = {
  isError?: boolean;
  structuredContent?: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
    summary?: string;
  };
};

const REQUIRED_TOOLS = [
  "list_data_sources",
  "list_databases",
  "execute_readonly_sql",
  "explain_sql",
  "analyze_mutation_sql",
  "get_kernel_info",
  "list_taurus_features",
  "find_top_slow_sql",
  "diagnose_db_hotspot",
  "list_recycle_bin",
];

function usage(): string {
  return `Usage: taurusdb-mcp acceptance [options]

Runs post-install acceptance checks against this installed taurusdb-mcp over
MCP stdio, using the same TAURUSDB_* environment the MCP client would use.
Checks that are not configured or not executed are reported as "pending" and
never count as passed. Output is redacted: hosts, IPs, usernames, and login
tokens are not written to the report.

Options:
  --report <file>                   Write a JSON acceptance record
  --instance-id <id>                Select this TaurusDB instance and complete the
                                    printed local login URL in a browser
  --datasource <name>               Datasource template (default: configured default)
  --database <name>                 Database used for readonly and advice checks
  --login-timeout <seconds>         Time to wait for browser login (default 300)
  --advice-sql <sql>                Mutation SQL to analyze; it is never executed
  --advice-snapshot-sql <sql>       Readonly SELECT compared before and after the
                                    advice call to prove nothing was written
  --restore-recycle-table <name>    Disposable recycle-bin object to restore
  --restore-destination-database <db>
  --restore-destination-table <table>
                                    Non-existing destination for the restore
  --confirm-disposable-restore      Required with the restore options. The restore
                                    WRITES to the database; use only objects you
                                    are prepared to recreate or drop.`;
}

function parseArgs(args: string[]): AcceptanceOptions {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    return next;
  };
  const timeout = value("--login-timeout");
  return {
    report: value("--report"),
    instanceId: value("--instance-id"),
    datasource: value("--datasource"),
    database: value("--database"),
    adviceSql: value("--advice-sql"),
    adviceSnapshotSql: value("--advice-snapshot-sql"),
    restoreRecycleTable: value("--restore-recycle-table"),
    restoreDestinationDatabase: value("--restore-destination-database"),
    restoreDestinationTable: value("--restore-destination-table"),
    confirmDisposableRestore: args.includes("--confirm-disposable-restore"),
    loginTimeoutSeconds: timeout ? Number.parseInt(timeout, 10) : 300,
  };
}

/** Removes endpoints, identities, and tokens from text that may reach a report. */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"']+/gi, "<url>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>")
    .replace(/\b[a-z0-9.-]+\.(?:myhuaweicloud\.com|huaweicloud\.com|com|net|cn)\b/gi, "<host>")
    .replace(/(user(?:name)?\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/'[^']*'@'[^']*'/g, "<account>")
    .slice(0, 400);
}

function maskId(id: string): string {
  return id.length <= 8 ? "****" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function errorText(result: ToolResult): string {
  const error = result.structuredContent?.error;
  return redact(`${error?.code ?? "ERROR"}: ${error?.message ?? result.structuredContent?.summary ?? "no details"}`);
}

export async function runAcceptance(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let options: AcceptanceOptions;
  try {
    options = parseArgs(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }

  const checks: CheckRecord[] = [];
  const record = (name: string, status: CheckStatus, detail: string) => {
    checks.push({ name, status, detail });
    process.stdout.write(`[${status}] ${name}${detail ? ` - ${detail}` : ""}\n`);
  };

  const serverEntry = fileURLToPath(new URL("../index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    stderr: "ignore",
  });
  const client = new Client({ name: "taurusdb-mcp-acceptance", version: VERSION });
  const call = async (name: string, toolArgs: Record<string, unknown> = {}): Promise<ToolResult> =>
    (await client.callTool({ name, arguments: toolArgs })) as ToolResult;
  const scope: Record<string, unknown> = {};
  if (options.datasource) scope.datasource = options.datasource;
  if (options.database) scope.database = options.database;

  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion()?.version;
    record("MCP initialize", serverVersion === VERSION ? "pass" : "fail", `server ${serverVersion ?? "unknown"}, CLI ${VERSION}`);

    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    const missing = REQUIRED_TOOLS.filter((name) => !tools.includes(name));
    record(
      "MCP tools/list",
      missing.length === 0 && !tools.includes("execute_sql") ? "pass" : "fail",
      missing.length > 0 ? `missing: ${missing.join(", ")}` : `${tools.length} tools, no general mutation tool`,
    );
    await client.ping();
    record("MCP ping", "pass", "");

    let connected = false;
    let notConnectedReason = "browser login was not completed";
    if (!options.instanceId) {
      const sources = await call("list_data_sources");
      const data = sources.structuredContent?.data as
        | { items?: Array<{ name?: string; host?: string }>; default_datasource?: string }
        | undefined;
      const target = options.datasource ?? data?.default_datasource;
      connected = Boolean(data?.items?.find((item) => item.name === target)?.host);
      notConnectedReason = "no database target is configured; pass --instance-id or configure a datasource host";
    } else {
      const selected = await call("select_cloud_taurus_instance", {
        instance_id: options.instanceId,
        ...(options.datasource ? { datasource: options.datasource } : {}),
      });
      if (selected.isError) {
        record("Cloud instance selection", "fail", errorText(selected));
      } else {
        const loginUrl = String(selected.structuredContent?.data?.login_url ?? "");
        // The login URL is printed for the operator only; it never enters the report.
        process.stderr.write(`\nOpen this local login URL in a browser on this machine and sign in:\n  ${loginUrl}\n\n`);
        const deadline = Date.now() + options.loginTimeoutSeconds * 1000;
        while (Date.now() < deadline && !connected) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const binding = await call("get_session_binding", options.datasource ? { datasource: options.datasource } : {});
          const override = binding.structuredContent?.data?.runtime_override as { has_sql_credentials_override?: boolean } | undefined;
          connected = Boolean(override?.has_sql_credentials_override);
        }
        record(
          "Cloud instance selection and local login",
          connected ? "pass" : "pending",
          connected ? `instance ${maskId(options.instanceId)}` : "browser login was not completed before the timeout",
        );
      }
    }

    if (!connected) {
      for (const name of ["Readonly query", "SQL Advice does not write", "Diagnostics", "Recycle-bin recovery"]) {
        record(name, "pending", notConnectedReason);
      }
    } else {
      const readonly = await call("execute_readonly_sql", { ...scope, sql: "SELECT 1 AS ok" });
      record("Readonly query", readonly.isError ? "fail" : "pass", readonly.isError ? errorText(readonly) : "SELECT 1 returned");

      if (!options.adviceSql) {
        record("SQL Advice does not write", "pending", "--advice-sql was not provided");
      } else {
        const snapshot = async () => {
          if (!options.adviceSnapshotSql) return undefined;
          const result = await call("execute_readonly_sql", { ...scope, sql: options.adviceSnapshotSql });
          if (result.isError) throw new Error(errorText(result));
          return JSON.stringify(result.structuredContent?.data?.rows ?? null);
        };
        try {
          const before = await snapshot();
          const advice = await call("analyze_mutation_sql", { ...scope, sql: options.adviceSql });
          const after = await snapshot();
          const notExecuted = !advice.isError && advice.structuredContent?.data?.execution_status === "not_executed";
          if (!notExecuted) {
            record("SQL Advice does not write", "fail", advice.isError ? errorText(advice) : "execution_status was not not_executed");
          } else if (before === undefined) {
            record("SQL Advice does not write", "pending", "advice returned not_executed; provide --advice-snapshot-sql to prove database state is unchanged");
          } else {
            record("SQL Advice does not write", before === after ? "pass" : "fail", before === after ? "snapshot unchanged" : "snapshot changed after advice");
          }
        } catch (error) {
          record("SQL Advice does not write", "fail", redact(error instanceof Error ? error.message : String(error)));
        }
      }

      const diagnostics = [
        ["get_kernel_info", {}],
        ["list_taurus_features", {}],
        ["find_top_slow_sql", scope],
        ["diagnose_db_hotspot", scope],
      ] as const;
      const failures: string[] = [];
      for (const [name, toolArgs] of diagnostics) {
        const result = await call(name, { ...toolArgs });
        if (result.isError) failures.push(`${name}: ${errorText(result)}`);
      }
      record("Diagnostics", failures.length === 0 ? "pass" : "fail", failures.length === 0 ? diagnostics.map(([name]) => name).join(", ") : failures.join("; "));

      const restoreRequested = Boolean(options.restoreRecycleTable || options.restoreDestinationDatabase || options.restoreDestinationTable);
      if (!restoreRequested) {
        record("Recycle-bin recovery", "pending", "no disposable recycle-bin object was specified");
      } else if (!options.restoreRecycleTable || !options.restoreDestinationDatabase || !options.restoreDestinationTable) {
        record("Recycle-bin recovery", "fail", "all three --restore-* options are required");
      } else if (!options.confirmDisposableRestore) {
        record("Recycle-bin recovery", "pending", "--confirm-disposable-restore was not given; nothing was restored");
      } else if (!tools.includes("restore_recycle_bin_table")) {
        record("Recycle-bin recovery", "pending", "restore_recycle_bin_table is disabled by configuration");
      } else {
        const restored = await call("restore_recycle_bin_table", {
          ...(options.datasource ? { datasource: options.datasource } : {}),
          recycle_table: options.restoreRecycleTable,
          destination_database: options.restoreDestinationDatabase,
          destination_table: options.restoreDestinationTable,
        });
        const verified = !restored.isError && restored.structuredContent?.data?.verified === true;
        record("Recycle-bin recovery", verified ? "pass" : "fail", verified ? "restored and verified" : errorText(restored));
      }
    }
  } catch (error) {
    record("Acceptance run", "fail", redact(error instanceof Error ? error.message : String(error)));
  } finally {
    await transport.close().catch(() => undefined);
  }

  const failed = checks.filter((check) => check.status === "fail").length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const outcome = failed > 0 ? "failed" : pending > 0 ? "incomplete" : "accepted";
  process.stdout.write(`\nAcceptance ${outcome}: ${checks.length - failed - pending} passed, ${failed} failed, ${pending} pending.\n`);
  if (options.report) {
    await writeFile(options.report, `${JSON.stringify({
      tool: "taurusdb-mcp acceptance",
      version: VERSION,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      completed_at: new Date().toISOString(),
      outcome,
      checks,
    }, null, 2)}\n`);
  }
  return failed > 0 ? 1 : pending > 0 ? 3 : 0;
}
