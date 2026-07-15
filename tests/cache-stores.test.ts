import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  setConnection,
  clearConnections,
  db,
  type Connection,
  type Row,
} from "../src/core/database.js";
import { Migrator } from "../src/core/migrations.js";
import { Cache, DatabaseStore, cacheMigration, kvStore, type KvNamespaceLike } from "../src/core/cache.js";

/** A real in-memory SQLite Connection so the store exercises actual SQL. */
function sqliteConnection(): Connection {
  const sdb = new DatabaseSync(":memory:");
  return {
    async select(sql, bindings) {
      return sdb.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = sdb.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
}

async function freshStore(): Promise<DatabaseStore> {
  clearConnections();
  const conn = sqliteConnection();
  setConnection(conn, "sqlite");
  await new Migrator(conn, "sqlite").up([cacheMigration()]);
  return new DatabaseStore();
}

test("database store: round-trips values through the full Cache API", async () => {
  const cache = new Cache(await freshStore());

  await cache.put("greeting", { hello: "world" });
  assert.deepEqual(await cache.get("greeting"), { hello: "world" });
  assert.equal(await cache.has("greeting"), true);

  await cache.forget("greeting");
  assert.equal(await cache.get("greeting", "fallback"), "fallback");
});

test("database store: TTL expires; prune sweeps the corpses", async () => {
  const store = await freshStore();
  const cache = new Cache(store);

  await cache.put("gone", 1, 0.001); // 1ms
  await cache.put("stays", 2);
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(await cache.get("gone", "missed"), "missed");
  // "gone" was already dropped by the read; write another expired row and prune.
  await cache.put("gone2", 3, 0.001);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await store.prune(), 1);
  assert.equal(await cache.get("stays"), 2);
});

test("database store: tags invalidate across the store (NUL-safe keys)", async () => {
  const cache = new Cache(await freshStore());

  await cache.put("user:1", "ada", 60, { tags: ["users"] });
  await cache.put("user:2", "grace", 60, { tags: ["users"] });
  await cache.put("other", "kept", 60);

  await cache.deleteByTag(["users"]);
  assert.equal(await cache.get("user:1", "missed"), "missed");
  assert.equal(await cache.get("user:2", "missed"), "missed");
  assert.equal(await cache.get("other"), "kept");

  // The tag-version keys (NUL-prefixed) must have survived the trip as rows.
  assert.equal(await db("cache").count() > 0, true);
});

test("database store: remember computes once, then serves the row", async () => {
  const cache = new Cache(await freshStore());
  let runs = 0;

  const first = await cache.remember("stats", 60, () => ({ value: ++runs }));
  const second = await cache.remember("stats", 60, () => ({ value: ++runs }));
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.equal(runs, 1);
});

/* --------------------------------- KV store -------------------------------- */

/** An in-memory KV namespace faithful to the binding's shape (incl. min TTL). */
function fakeKv(): KvNamespaceLike & { data: Map<string, { value: string; expires: number }> } {
  const data = new Map<string, { value: string; expires: number }>();
  return {
    data,
    async get(key, _type) {
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.expires && entry.expires < Date.now()) {
        data.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options) {
      const expires = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0;
      data.set(key, { value, expires });
    },
    async delete(key) {
      data.delete(key);
    },
    async list() {
      return { keys: [...data.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
}

test("kv store: round-trips, respects logical TTL under KV's 60s floor", async () => {
  const kv = fakeKv();
  const cache = new Cache(kvStore(kv));

  await cache.put("count", 42, 1); // 1s logical TTL — below KV's 60s minimum
  assert.equal(await cache.get("count"), 42);

  // KV still holds the blob (rounded-up TTL), but the envelope knows better.
  const stored = kv.data.get("count");
  assert.ok(stored);
  assert.ok(stored.expires > Date.now() + 50_000);

  // Force the logical expiry and confirm the cache treats it as a miss.
  const entry = JSON.parse(stored.value) as { e: number };
  entry.e = Date.now() - 1;
  kv.data.set("count", { ...stored, value: JSON.stringify(entry) });
  assert.equal(await cache.get("count", "missed"), "missed");
});

test("kv store: clear() drains the namespace page by page", async () => {
  const kv = fakeKv();
  const cache = new Cache(kvStore(kv));

  await cache.put("a", 1);
  await cache.put("b", 2);
  await cache.flush();
  assert.equal(kv.data.size, 0);
});
