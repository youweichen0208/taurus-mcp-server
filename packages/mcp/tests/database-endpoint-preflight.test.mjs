import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import {
  DatabaseEndpointPreflightError,
  preflightDatabaseEndpoint,
} from "../dist/security/database-endpoint-preflight.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("database endpoint preflight succeeds when the TCP port accepts connections", async () => {
  const server = createServer((socket) => socket.end());
  const port = await listen(server);
  try {
    await preflightDatabaseEndpoint("127.0.0.1", port, 500);
  } finally {
    await close(server);
  }
});

test("database endpoint preflight classifies a refused TCP port", async () => {
  const server = createServer();
  const port = await listen(server);
  await close(server);

  await assert.rejects(
    preflightDatabaseEndpoint("127.0.0.1", port, 500),
    (error) => error instanceof DatabaseEndpointPreflightError
      && error.kind === "refused"
      && error.port === port,
  );
});
