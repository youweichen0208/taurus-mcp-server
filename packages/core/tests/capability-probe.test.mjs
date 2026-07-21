import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityProbe } from "../dist/capability/probe.js";

function makeSession(values) {
  return {
    async execute(sql) {
      if (/SELECT taurus_version\(\) AS version/i.test(sql)) {
        if (!values.taurusVersion) {
          throw new Error("taurus_version() is unavailable");
        }
        return { rows: [{ version: values.taurusVersion }] };
      }

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
    taurusVersion: "2.0.69.250900",
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
  assert.equal(snapshot.kernelInfo.mysqlCompat, "8.0");
  assert.equal(snapshot.kernelInfo.kernelVersion, "2.0.69.250900");
  assert.equal(snapshot.features.flashback_query.param, "innodb_rds_backquery_enable=OFF");
  assert.equal(snapshot.features.parallel_query.available, true);
  assert.equal(snapshot.features.parallel_query.enabled, false);
  assert.equal(snapshot.features.parallel_query.param, "force_parallel_execute=OFF");
});

test("capability probe exposes parameter-level disable reasons for TaurusDB feature flags", async () => {
  const session = makeSession({
    version: "8.0.32 TaurusDB 2.0.69.250900",
    taurusVersion: "2.0.69.250900",
    variables: {
      version_comment: "TaurusDB Kernel",
      innodb_rds_backquery_enable: "ON",
      rds_recycle_bin_mode: "OFF",
      force_parallel_execute: "OFF",
      ndp_mode: "OFF",
      optimizer_switch: "index_merge=on,offset_pushdown=off",
      rds_multi_tenant: "OFF",
      rds_opt_outline_enabled: "OFF",
      rds_partition_level_mdl_enabled: "OFF",
      rds_dynamic_masking_enabled: "OFF",
      rds_nonblock_ddl_enable: "OFF",
      rds_hotspot: "OFF",
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

  assert.equal(snapshot.features.flashback_query.param, "innodb_rds_backquery_enable=ON");
  assert.equal(snapshot.features.ndp_pushdown.enabled, false);
  assert.equal(snapshot.features.ndp_pushdown.param, "ndp_mode=OFF");
  assert.equal(snapshot.features.offset_pushdown.enabled, false);
  assert.equal(snapshot.features.offset_pushdown.param, "optimizer_switch: offset_pushdown=off");
  assert.equal(snapshot.features.recycle_bin.enabled, false);
  assert.equal(snapshot.features.recycle_bin.param, "rds_recycle_bin_mode=OFF");
  assert.equal(snapshot.features.multi_tenant.enabled, false);
  assert.equal(snapshot.features.multi_tenant.param, "rds_multi_tenant=OFF");
  assert.equal(snapshot.features.statement_outline.enabled, false);
  assert.equal(snapshot.features.statement_outline.param, "rds_opt_outline_enabled=OFF");
  assert.equal(snapshot.features.partition_mdl.enabled, false);
  assert.equal(
    snapshot.features.partition_mdl.param,
    "rds_partition_level_mdl_enabled=OFF",
  );
  assert.equal(snapshot.features.dynamic_masking.enabled, false);
  assert.equal(
    snapshot.features.dynamic_masking.param,
    "rds_dynamic_masking_enabled=OFF",
  );
  assert.equal(snapshot.features.nonblocking_ddl.enabled, false);
  assert.equal(
    snapshot.features.nonblocking_ddl.param,
    "rds_nonblock_ddl_enable=OFF",
  );
  assert.equal(snapshot.features.hot_row_update.enabled, false);
  assert.equal(snapshot.features.hot_row_update.param, "rds_hotspot=OFF");
});

test("capability probe gates flashback by TaurusDB kernel version instead of MySQL compatibility version", async () => {
  const session = makeSession({
    version: "8.0.22-30",
    taurusVersion: "2.0.78.260600",
    variables: {
      version_comment: "TaurusDB Kernel",
      innodb_rds_backquery_enable: "ON",
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

  const snapshot = await probe.probe({ datasource: "taurus_mcp" });

  assert.equal(snapshot.kernelInfo.rawVersion, "8.0.22-30");
  assert.equal(snapshot.kernelInfo.mysqlCompat, "8.0");
  assert.equal(snapshot.kernelInfo.kernelVersion, "2.0.78.260600");
  assert.equal(snapshot.features.flashback_query.available, true);
  assert.equal(snapshot.features.flashback_query.enabled, true);
});

test("capability probe fails closed when only a MySQL compatibility version is available", async () => {
  const session = makeSession({
    version: "8.0.22-30",
    variables: {
      version_comment: "TaurusDB Kernel",
      innodb_rds_backquery_enable: "ON",
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

  const snapshot = await probe.probe({ datasource: "taurus_mcp" });

  assert.equal(snapshot.kernelInfo.kernelVersion, undefined);
  assert.equal(snapshot.features.flashback_query.available, false);
  assert.match(snapshot.features.flashback_query.reason, /current: unknown/);
});
