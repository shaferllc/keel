import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  setConnection,
  clearConnections,
  type Connection,
  type Row,
} from "../src/core/database.js";
import { Migrator } from "../src/core/migrations.js";
import {
  Features,
  DatabaseFlagStore,
  flagsMigration,
  flagScopeKey,
  features,
  setFeatures,
  feature,
  MemoryFlagStore,
} from "../src/core/flags.js";

class User {
  constructor(public id: number, public plan = "free") {}
}

test("scope keys: global, primitives, and identified objects", () => {
  assert.equal(flagScopeKey(null), "__global");
  assert.equal(flagScopeKey("team-7"), "team-7");
  assert.equal(flagScopeKey(new User(7)), "User:7");
  assert.throws(() => flagScopeKey({}), /object with an `id`/);
});

test("a resolver decides per scope, and the first answer sticks", async () => {
  const flags = new Features();
  let resolutions = 0;
  flags.define("new-billing", (scope) => {
    resolutions++;
    return (scope as User).plan === "pro";
  });

  const pro = new User(1, "pro");
  const free = new User(2, "free");

  assert.equal(await flags.active("new-billing", pro), true);
  assert.equal(await flags.active("new-billing", free), false);

  // Resolved once per scope — later checks read the stored answer.
  await flags.active("new-billing", pro);
  await flags.active("new-billing", free);
  assert.equal(resolutions, 2);

  // Even if the resolver's world changes, the stored answer holds…
  free.plan = "pro";
  assert.equal(await flags.active("new-billing", free), false);

  // …until it's forgotten.
  await flags.forget("new-billing", free);
  assert.equal(await flags.active("new-billing", free), true);
});

test("activate/deactivate override the resolver; values can be rich", async () => {
  const flags = new Features();
  flags.define("search", () => false);

  const user = new User(9);
  await flags.activate("search", user, { engine: "meili" });
  assert.equal(await flags.active("search", user), true);
  assert.deepEqual(await flags.value("search", user), { engine: "meili" });

  await flags.deactivate("search", user);
  assert.equal(await flags.active("search", user), false);
});

test("an undefined flag is off, not an error", async () => {
  const flags = new Features();
  assert.equal(await flags.active("nobody-defined-this"), false);
});

test("fixed-value flags and global scope", async () => {
  const flags = new Features();
  flags.define("dark-mode", true);
  assert.equal(await flags.active("dark-mode"), true);
  await flags.deactivate("dark-mode");
  assert.equal(await flags.active("dark-mode"), false);
});

test("purge clears one flag's stored values without touching others", async () => {
  const flags = new Features(new MemoryFlagStore());
  flags.define("a", () => true);
  flags.define("ab", () => true);
  await flags.active("a", "x");
  await flags.active("ab", "x");
  await flags.deactivate("a", "x");

  await flags.purge("a");
  assert.equal(await flags.active("a", "x"), true); // re-resolved
  assert.equal(await flags.active("ab", "x"), true); // untouched (no collision)
});

test("the global helpers mirror the queue/cache pattern", async () => {
  const flags = setFeatures(new MemoryFlagStore());
  flags.define("greeting", () => true);
  assert.equal(features(), flags);
  assert.equal(await feature("greeting"), true);
});

test("database store: values survive as rows, unique per (name, scope)", async () => {
  clearConnections();
  const sdb = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return sdb.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = sdb.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  await new Migrator(conn, "sqlite").up([flagsMigration()]);

  const flags = new Features(new DatabaseFlagStore());
  flags.define("rollout", (scope) => (scope as User).id % 2 === 0);

  assert.equal(await flags.active("rollout", new User(2)), true);
  assert.equal(await flags.active("rollout", new User(3)), false);

  // A second Features (another process) sees the same stored decisions.
  const elsewhere = new Features(new DatabaseFlagStore());
  assert.equal(await elsewhere.active("rollout", new User(2)), true);

  // Overrides update in place — the unique index holds.
  await flags.activate("rollout", new User(3));
  assert.equal(await elsewhere.active("rollout", new User(3)), true);

  // Purge drops every row; a Features with no resolver now reports "off".
  await flags.purge();
  assert.equal(await elsewhere.value("rollout", new User(2)), false);
});
