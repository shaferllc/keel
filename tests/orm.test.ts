import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { db, setConnection, type Connection, type Row } from "../src/core/database.js";

class Post extends Model {
  static table = "posts";
  static timestamps = true;
  declare id: number;
  declare title: string;
  declare views: number;
}

// A mock that answers COUNT / aggregate / SELECT differently and records writes.
function mock(rows: Row[] = [], agg?: number) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const conn = {
    select: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      if (/COUNT\(\*\)/.test(sql)) return [{ count: rows.length }];
      if (/\bAS agg\b/.test(sql)) return [{ agg }];
      return rows;
    },
    write: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rowsAffected: 1, insertId: 7 };
    },
  } as Connection;
  return { conn, calls };
}

test("timestamps: create stamps created_at + updated_at", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const post = await Post.create({ title: "Hi" });

  assert.match(calls[0]!.sql, /INSERT INTO posts \(title, created_at, updated_at\)/);
  assert.ok(typeof post.created_at === "string" && typeof post.updated_at === "string");
  assert.equal(post.created_at, post.updated_at); // same instant on insert
});

test("timestamps: save re-stamps updated_at but never created_at", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const original = "2020-01-01T00:00:00.000Z";
  const post = new Post({ id: 3, title: "Hi", created_at: original });
  await post.save();

  assert.match(calls[0]!.sql, /^UPDATE posts SET/);
  assert.match(calls[0]!.sql, /updated_at = \?/);
  assert.equal(post.created_at, original); // created_at left as-is (not re-stamped)
  assert.notEqual(post.updated_at, original); // updated_at re-stamped to now
  assert.equal(typeof post.updated_at, "string");
});

test("a model without timestamps writes no timestamp columns", async () => {
  class Plain extends Model {
    static table = "plain";
  }
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await Plain.create({ a: 1 });
  assert.match(calls[0]!.sql, /INSERT INTO plain \(a\)/);
  assert.doesNotMatch(calls[0]!.sql, /created_at/);
});

test("aggregates: sum / avg / min / max", async () => {
  setConnection(mock([], 42).conn, "sqlite");
  assert.equal(await db("posts").sum("views"), 42);
  setConnection(mock([], 3.5).conn, "sqlite");
  assert.equal(await db("posts").where("id", ">", 1).avg("views"), 3.5);
  setConnection(mock([], 0).conn, "sqlite");
  assert.equal(await db("posts").min("views"), 0);
});

test("where conveniences: between, notIn, like", async () => {
  const { conn, calls } = mock([{ id: 1 }]);
  setConnection(conn, "sqlite");
  await db("posts").whereBetween("views", [10, 100]).whereNotIn("id", [4, 5]).whereLike("title", "%hi%").get();
  const { sql, bindings } = calls[0]!;
  assert.match(sql, /views BETWEEN \? AND \?/);
  assert.match(sql, /id NOT IN \(\?, \?\)/);
  assert.match(sql, /title LIKE \?/);
  assert.deepEqual(bindings, [10, 100, 4, 5, "%hi%"]);
});

test("latest / oldest order by a timestamp column", async () => {
  const { conn, calls } = mock([]);
  setConnection(conn, "sqlite");
  await db("posts").latest().get();
  assert.match(calls[0]!.sql, /ORDER BY created_at DESC/);
  await db("posts").oldest("published_at").get();
  assert.match(calls[1]!.sql, /ORDER BY published_at ASC/);
});

test("value returns one column; pluck returns a column array", async () => {
  setConnection(mock([{ title: "A" }]).conn, "sqlite");
  assert.equal(await db("posts").where("id", 1).value("title"), "A");
  setConnection(mock([{ title: "A" }, { title: "B" }]).conn, "sqlite");
  assert.deepEqual(await db("posts").pluck("title"), ["A", "B"]);
});

test("builder paginate returns data + metadata", async () => {
  const { conn, calls } = mock([{ id: 1 }, { id: 2 }, { id: 3 }]);
  setConnection(conn, "sqlite");
  const page = await db("posts").paginate(2, 3);
  assert.equal(page.perPage, 3);
  assert.equal(page.currentPage, 2);
  assert.equal(page.total, 3);
  assert.equal(page.lastPage, 1);
  // the data query paginates with LIMIT/OFFSET
  const dataSql = calls.find((c) => /LIMIT/.test(c.sql))!.sql;
  assert.match(dataSql, /LIMIT 3 OFFSET 3/);
});

test("Model.paginate hydrates models", async () => {
  setConnection(mock([{ id: 1, title: "A" }, { id: 2, title: "B" }]).conn, "sqlite");
  const page = await Post.paginate(1, 10);
  assert.ok(page.data[0] instanceof Post);
  assert.equal(page.data.length, 2);
  assert.equal(page.lastPage, 1);
});

test("firstOrCreate returns existing or creates", async () => {
  // exists -> returns it, no insert
  const found = mock([{ id: 5, title: "Hi" }]);
  setConnection(found.conn, "sqlite");
  const a = await Post.firstOrCreate({ title: "Hi" });
  assert.equal(a.id, 5);
  assert.ok(!found.calls.some((c) => /INSERT/.test(c.sql)));

  // missing -> creates
  const missing = mock([]);
  setConnection(missing.conn, "sqlite");
  await Post.firstOrCreate({ title: "New" }, { views: 0 });
  assert.ok(missing.calls.some((c) => /INSERT INTO posts/.test(c.sql)));
});

test("updateOrCreate updates an existing match", async () => {
  const { conn, calls } = mock([{ id: 9, title: "Hi", views: 1 }]);
  setConnection(conn, "sqlite");
  const post = await Post.updateOrCreate({ title: "Hi" }, { views: 99 });
  assert.equal(post.id, 9);
  assert.equal(post.views, 99);
  assert.ok(calls.some((c) => /^UPDATE posts SET/.test(c.sql)));
});

test("instance update = fill + save; refresh reloads columns", async () => {
  const { conn, calls } = mock([{ id: 2, title: "Fresh", views: 5 }]);
  setConnection(conn, "sqlite");
  const post = new Post({ id: 2, title: "Old" });
  await post.update({ title: "New" });
  assert.equal(post.title, "New");
  assert.ok(calls.some((c) => /^UPDATE posts SET/.test(c.sql)));

  await post.refresh();
  assert.equal(post.title, "Fresh");
  assert.equal(post.views, 5);
});
