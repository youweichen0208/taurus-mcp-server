#!/usr/bin/env node

import { runInit } from "./commands/init.js";
import { runCredentials } from "./commands/credentials.js";
import { runApprove } from "./commands/approve.js";
import { runAcceptance } from "./commands/acceptance.js";
import { startMcpServer } from "./server.js";
import { VERSION } from "./version.js";

function usage(): string {
  return `taurusdb-mcp ${VERSION}

Usage:
  taurusdb-mcp                 Start the MCP server on stdio (default)
  taurusdb-mcp init            Write MCP client configuration
  taurusdb-mcp credentials     Configure or check stored cloud credentials
  taurusdb-mcp approve         Sign an approval token for a high-risk readonly query
  taurusdb-mcp acceptance      Run post-install acceptance checks over MCP stdio
  taurusdb-mcp --version, -v   Print the version
  taurusdb-mcp --help, -h      Print this help

Run "taurusdb-mcp <command> --help" for command options.`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (firstArg === "init") {
    process.exitCode = await runInit(args.slice(1));
    return;
  }

  if (firstArg === "credentials") {
    process.exitCode = await runCredentials(args.slice(1));
    return;
  }

  if (firstArg === "approve") {
    process.exitCode = await runApprove(args.slice(1));
    return;
  }

  if (firstArg === "acceptance") {
    process.exitCode = await runAcceptance(args.slice(1));
    return;
  }

  if (firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  await startMcpServer();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
