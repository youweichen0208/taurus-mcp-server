import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityProbe } from "../dist/capability/probe.js";

function makeSession(values) {
  return {
    async execute(sql) {
      if (/SELECT VERSION\(\) AS version/i.test(sql)) {
        return { rows: [{ version: values.version ?? "8.0.22-30" }] };
      }

      const variableMatch = sql.match(/SHOW VARIABLES LIKE '([^']+)'/i);
      if (!variableMatch) {
        throw new Error(`Unexpected SQL: ${sql}`);
      }

      const name = variableMatch[1];
      if (!(name in values.variables)) {
        return { rows: [] };
      }

      return {
        rows: [
          {
            Variable_name: name,
            Value: values.variables[name],
          },
        ],
      };
    },
  };
}

test("capability probe treats Taurus-specific variables as TaurusDB signals even when disabled", async () => {
  const session = makeSession({
    version: "8.0.22-30",
    variables: {
      version_comment: "MySQL Community Server - GPL",
      force_parallel_execute: "OFF",
      innodb_rds_backquery_enable: "OFF",
    },
  });
  const probe = createCapabilityProbe({
    connectionPool: {
      async acquire() {
        return session;
      },
      async release() {},
    },
  });

  const snapshot = await probe.probe({
    datasource: "taurus_mcp",
  });

  assert.equal(snapshot.kernelInfo.isTaurusDB, true);
  assert.equal(snapshot.kernelInfo.rawVersion, "8.0.22-30");
  assert.equal(snapshot.features.parallel_query.available, true);
  assert.equal(snapshot.features.parallel_query.enabled, false);
  assert.equal(snapshot.features.parallel_query.param, "force_parallel_execute=OFF");
});
