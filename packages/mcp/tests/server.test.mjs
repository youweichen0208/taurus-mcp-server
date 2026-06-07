import assert from "node:assert/strict";
import test from "node:test";

import { createConfigFromEnv } from "taurusdb-core";
import { createServer } from "../dist/server.js";

test("closing the MCP server closes credential login and engine dependencies", async () => {
  const closed = [];
  const deps = {
    config: createConfigFromEnv({}),
    profileLoader: {},
    engine: {
      async close() {
        closed.push("engine");
      },
    },
    credentialLogin: {
      async close() {
        closed.push("credentialLogin");
      },
    },
    pingResponse: "pong",
  };

  const server = createServer(deps);
  await server.close();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(closed.sort(), ["credentialLogin", "engine"]);
});
