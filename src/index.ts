#!/usr/bin/env node

import { runInit } from "./commands/init.js";
import { startMcpServer } from "./server.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (firstArg === "init") {
    process.exitCode = await runInit(args.slice(1));
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
