import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { castGet, castSet } from "../src/core/casts.js";
import { setConnection, type Connection } from "../src/core/database.js";

class Post extends Model {
  static table = "posts";
  static casts = {
    published: "boolean",
    views: "int",
    meta: "json",
    posted_at: "date",
  } as const;
  static fillable = ["title", "published", "meta"];
  declare id: number;
  declare title: string;
  declare published: boolean;
  declare views: number;
  declare meta: Record<string, unknown>;
}

function mock(rows: unknown[] = []) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const conn = {
    select: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return rows;
    },
    write: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rowsAffected: 1, insertId: 7 };
    },
  } as Connection;
  return { conn, calls };
}

test("castGet turns storage values into JS types", () => {
  assert.equal(castGet(1, "boolean"), true);
  assert.equal(castGet("0", "boolean"), false);
  assert.equal(castGet("42", "int"), 42);
  assert.equal(castGet("3.5", "float"), 3.5);
  assert.deepEqual(castGet('{"a":1}', "json"), { a: 1 });
  assert.ok(castGet("2026-07-10T00:00:00.000Z", "date") instanceof Date);
  assert.equal(castGet(null, "int"), null); // null passes through
});

test("castSet turns JS types into storage values", () => {
  assert.equal(castSet(true, "boolean"), 1);
  assert.equal(castSet(false, "boolean"), 0);
  assert.equal(castSet({ a: 1 }, "json"), '{"a":1}');
  assert.equal(castSet(new Date("2026-07-10T00:00:00.000Z"), "date"), "2026-07-10T00:00:00.000Z");
  assert.equal(castSet(null, "json"), null);
});

test("hydration casts raw DB rows to JS types", async () => {
  setConnection(mock([{ id: 1, title: "Hi", published: 1, views: "10", meta: '{"tag":"x"}' }]).conn, "sqlite");
  const post = await Post.find(1);
  assert.equal(post!.published, true);
  assert.equal(post!.views, 10);
  assert.deepEqual(post!.meta, { tag: "x" });
});

test("save casts JS types back to storable primitives", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const post = new Post({ id: 1, title: "Hi" });
  post.published = true;
  post.meta = { tag: "y" };
  await post.save();

  const update = calls[0]!;
  assert.match(update.sql, /^UPDATE posts SET/);
  // booleans -> 0/1, objects -> JSON strings
  assert.ok(update.bindings.includes(1));
  assert.ok(update.bindings.includes('{"tag":"y"}'));
  assert.ok(!update.bindings.some((b) => typeof b === "boolean" || (b && typeof b === "object")));
});

test("create only mass-assigns fillable columns", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await Post.create({ title: "Hi", published: true, admin_only: "hax", id: 999 });

  const insert = calls[0]!;
  // id and admin_only are not fillable -> dropped
  assert.match(insert.sql, /INSERT INTO posts \(title, published\)/);
  assert.doesNotMatch(insert.sql, /admin_only|id/);
  assert.deepEqual(insert.bindings, ["Hi", 1]); // published cast to 1
});

test("fill respects fillable; forceFill bypasses it", () => {
  setConnection(mock().conn, "sqlite");
  const post = new Post({ id: 1 });

  post.fill({ title: "A", admin_only: "nope" });
  assert.equal(post.title, "A");
  assert.equal(post.admin_only, undefined); // guarded out

  post.forceFill({ admin_only: "forced" });
  assert.equal(post.admin_only, "forced");
});

test("fill casts assigned values", () => {
  setConnection(mock().conn, "sqlite");
  const post = new Post({});
  post.fill({ published: 1, meta: '{"k":1}' });
  assert.equal(post.published, true);
  assert.deepEqual(post.meta, { k: 1 });
});

test("guarded denylist blocks only listed columns", async () => {
  class Account extends Model {
    static table = "accounts";
    static guarded = ["is_admin"];
  }
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await Account.create({ name: "Ada", is_admin: true });
  assert.match(calls[0]!.sql, /INSERT INTO accounts \(name\)/);
  assert.deepEqual(calls[0]!.bindings, ["Ada"]);
});

test("toJSON emits cast JS values", async () => {
  setConnection(mock([{ id: 1, title: "Hi", published: 1, meta: '{"t":1}' }]).conn, "sqlite");
  const post = await Post.find(1);
  const json = post!.toJSON();
  assert.equal(json.published, true);
  assert.deepEqual(json.meta, { t: 1 });
});

test("models without casts/fillable behave as before (backward compatible)", async () => {
  class Plain extends Model {
    static table = "plain";
  }
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await Plain.create({ a: 1, b: "two", c: true });
  // everything passes through untouched
  assert.match(calls[0]!.sql, /INSERT INTO plain \(a, b, c\)/);
  assert.deepEqual(calls[0]!.bindings, [1, "two", true]);
});
