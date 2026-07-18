import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { signApprovalRequest } from "taurusdb-core";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function expandTilde(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

function usage(): string {
  return `Usage: taurusdb-mcp approve --request <approval-request> --actor <identity> [options]

Options:
  --secret-file <path>  Approval secret file; defaults to
                        TAURUSDB_MUTATION_APPROVAL_SECRET_FILE
  --request <value>     approval_request returned by a mutation tool
  --actor <identity>    Human approver identity recorded in the signed token

The command prints a one-time approval_token. Run it outside the MCP client
after reviewing the SQL hash, datasource, database, risk, and expiry encoded
in approval_request.`;
}

async function readProtectedSecret(filePath: string): Promise<string> {
  const resolved = expandTilde(filePath);
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error("Mutation approval secret path must reference a regular file.");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("Mutation approval secret file must not be accessible by group or other users.");
  }
  const secret = (await readFile(resolved, "utf8")).trim();
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Mutation approval secret must contain at least 32 bytes.");
  }
  return secret;
}

export async function runApprove(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const request = readOption(args, "--request");
  const actor = readOption(args, "--actor");
  const secretFile =
    readOption(args, "--secret-file") ??
    process.env.TAURUSDB_MUTATION_APPROVAL_SECRET_FILE?.trim();
  if (!request || !actor || !secretFile) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  const secret = await readProtectedSecret(secretFile);
  process.stdout.write(`${signApprovalRequest(request, actor, secret)}\n`);
  return 0;
}
