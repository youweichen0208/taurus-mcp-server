import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExplainRecommendations,
  normalizeExplainRows,
  summarizeExplainRows,
} from "../dist/executor/explain.js";

test("normalizeExplainRows keeps object rows", () => {
  const rows = normalizeExplainRows({
    rows: [
      { type: "ALL", key: null, rows: 100 },
      { type: "ref", key: "idx_a", rows: 10 },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "ALL");
});

test("normalizeExplainRows maps array rows by fields", () => {
  const rows = normalizeExplainRows({
    fields: [{ name: "type" }, { name: "key" }, { name: "rows" }, { name: "Extra" }],
    rows: [
      ["ALL", null, 100, "Using temporary"],
      ["ref", "idx_a", 10, null],
    ],
  });

  assert.deepEqual(rows, [
    { type: "ALL", key: null, rows: 100, Extra: "Using temporary" },
    { type: "ref", key: "idx_a", rows: 10, Extra: null },
  ]);
});

test("summarizeExplainRows extracts risk summary signals", () => {
  const summary = summarizeExplainRows([
    { type: "ALL", key: null, rows: 1000, Extra: "Using where; Using filesort" },
    { type: "ref", key: "idx_users_id", rows: 200, Extra: "Using temporary" },
  ]);

  assert.equal(summary.fullTableScanLikely, true);
  assert.equal(summary.indexHitLikely, false);
  assert.equal(summary.estimatedRows, 1200);
  assert.equal(summary.usesTempStructure, true);
  assert.equal(summary.usesFilesort, true);
  assert.ok(summary.riskHints.length >= 1);
});

test("buildExplainRecommendations includes high-row guidance", () => {
  const recommendations = buildExplainRecommendations({
    fullTableScanLikely: true,
    indexHitLikely: false,
    estimatedRows: 150_000,
    usesTempStructure: true,
    usesFilesort: false,
    riskHints: [],
  });

  assert.ok(
    recommendations.some((item) => item.includes("full table scans")),
  );
  assert.ok(
    recommendations.some((item) => item.includes("Estimated row count is high")),
  );
  assert.ok(
    recommendations.some((item) => item.includes("temporary structures")),
  );
});
