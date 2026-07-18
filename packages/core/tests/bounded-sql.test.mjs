import assert from "node:assert/strict";
import test from "node:test";

import { buildServerBoundedReadonlySql } from "../dist/executor/bounded-sql.js";

test("server-bounded readonly SQL caps SELECT before rows enter the MCP process", () => {
  assert.equal(
    buildServerBoundedReadonlySql("SELECT * FROM orders LIMIT 100000;", 200),
    "SELECT * FROM (SELECT * FROM orders LIMIT 100000) AS __taurus_mcp_bounded LIMIT 201",
  );
});

test("server-bounded readonly SQL leaves SHOW statements unwrapped", () => {
  assert.equal(
    buildServerBoundedReadonlySql("SHOW VARIABLES", 200),
    "SHOW VARIABLES",
  );
});
