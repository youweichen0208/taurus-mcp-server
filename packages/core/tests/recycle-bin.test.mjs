import assert from "node:assert/strict";
import test from "node:test";

import { buildRestoreRecycleBinTableSql } from "../dist/taurus/recycle-bin.js";

test("insert-select recycle-bin restore supports database names containing hyphens", () => {
  assert.equal(
    buildRestoreRecycleBinTableSql({
      recycleTable: "RECYCLE_123",
      method: "insert_select",
      destinationDatabase: "db-1",
      destinationTable: "orders",
    }),
    "INSERT INTO `db-1`.`orders` SELECT * FROM `__recyclebin__`.`RECYCLE_123`",
  );
});
