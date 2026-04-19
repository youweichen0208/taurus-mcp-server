import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySchemaCache, makeSchemaCacheKey } from "../dist/schema/cache.js";

function makeSchema(database, table, tag = "") {
  return {
    database,
    table,
    columns: [{ name: `id${tag}`, dataType: "bigint", nullable: false }],
    indexes: [{ name: "PRIMARY", columns: ["id"], unique: true }],
  };
}

test("schema cache stores and retrieves values", () => {
  const cache = new InMemorySchemaCache({ ttlMs: 60_000, maxEntries: 10, now: () => 1000 });
  const key = { datasource: "ds", database: "demo", table: "orders" };

  assert.equal(cache.get(key), undefined);
  cache.set(key, makeSchema("demo", "orders"));
  const value = cache.get(key);

  assert.ok(value);
  assert.equal(value.table, "orders");

  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

test("schema cache expires entries by ttl", () => {
  let now = 1000;
  const cache = new InMemorySchemaCache({ ttlMs: 100, maxEntries: 10, now: () => now });
  const key = { datasource: "ds", database: "demo", table: "orders" };

  cache.set(key, makeSchema("demo", "orders"));
  assert.ok(cache.get(key));

  now = 1201;
  assert.equal(cache.get(key), undefined);
  assert.equal(cache.stats().size, 0);
});

test("schema cache evicts oldest entry when maxEntries exceeded (LRU)", () => {
  const cache = new InMemorySchemaCache({ ttlMs: 60_000, maxEntries: 2, now: () => 1000 });

  const k1 = { datasource: "ds", database: "demo", table: "t1" };
  const k2 = { datasource: "ds", database: "demo", table: "t2" };
  const k3 = { datasource: "ds", database: "demo", table: "t3" };

  cache.set(k1, makeSchema("demo", "t1"));
  cache.set(k2, makeSchema("demo", "t2"));
  assert.ok(cache.get(k1));
  cache.set(k3, makeSchema("demo", "t3"));

  assert.ok(cache.get(k1));
  assert.equal(cache.get(k2), undefined);
  assert.ok(cache.get(k3));
  assert.equal(cache.stats().evictions, 1);
});

test("schema cache invalidate removes matching scope", () => {
  const cache = new InMemorySchemaCache({ ttlMs: 60_000, maxEntries: 10, now: () => 1000 });

  const k1 = { datasource: "ds1", database: "db1", table: "t1" };
  const k2 = { datasource: "ds1", database: "db2", table: "t2" };
  const k3 = { datasource: "ds2", database: "db1", table: "t1" };

  cache.set(k1, makeSchema("db1", "t1"));
  cache.set(k2, makeSchema("db2", "t2"));
  cache.set(k3, makeSchema("db1", "t1", "_ds2"));

  cache.invalidate("ds1", "db1");
  assert.equal(cache.get(k1), undefined);
  assert.ok(cache.get(k2));
  assert.ok(cache.get(k3));

  cache.invalidate("ds1");
  assert.equal(cache.get(k2), undefined);
  assert.ok(cache.get(k3));

  cache.invalidate("ds2", "db1", "t1");
  assert.equal(cache.get(k3), undefined);
});

test("schema cache key normalization is case-insensitive", () => {
  const keyA = makeSchemaCacheKey({
    datasource: "Prod_DS",
    database: "Sales",
    table: "Orders",
  });
  const keyB = makeSchemaCacheKey({
    datasource: "prod_ds",
    database: "sales",
    table: "orders",
  });
  assert.equal(keyA, keyB);
});
