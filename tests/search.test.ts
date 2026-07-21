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
import { Model } from "../src/core/model.js";
import { clearModelHooks } from "../src/core/model-events.js";
import {
  search,
  reindex,
  registerSearchable,
  setSearchDriver,
  searchDriver,
  MemoryDriver,
  DatabaseDriver,
  searchMigration,
  documentText,
} from "../src/core/search.js";

class Post extends Model {
  static table = "posts";
  static searchable = ["title", "body"];
  declare id: number;
  declare title: string;
  declare body: string;
}

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

/** A posts table with three rows, and whichever search driver the test wants. */
async function fixture(driver = new MemoryDriver() as never): Promise<Connection> {
  clearConnections();
  clearModelHooks();
  const conn = sqliteConnection();
  setConnection(conn, "sqlite");
  setSearchDriver(driver);

  await conn.write(
    "CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT)",
    [],
  );
  const rows: [string, string][] = [
    ["Edge runtime basics", "Running a framework on the edge without a Node runtime"],
    ["Queues and jobs", "Durable background jobs, retries, and failed job handling"],
    // Says "runtime" three times, so ranking against the single-mention posts is
    // unambiguous rather than a tie broken by id.
    ["Runtime configuration", "Configure the runtime: runtime flags and runtime env vars"],
  ];
  for (const [title, body] of rows) {
    await conn.write("INSERT INTO posts (title, body) VALUES (?, ?)", [title, body]);
  }
  return conn;
}

/* --------------------------------- basics --------------------------------- */

test("documentText flattens a document's scalar fields, skipping objects and nulls", () => {
  const text = documentText({ title: "Hello", body: "World", meta: { a: 1 }, missing: null, n: 42 });
  assert.equal(text, "Hello World 42");
});

test("search returns models in relevance order", async () => {
  await fixture();
  await reindex(Post);

  const hits = await search(Post, "runtime").get();
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((p) => p instanceof Post));
  // "Runtime configuration" says runtime three times; it outranks a single mention.
  assert.equal(hits[0]!.title, "Runtime configuration");
});

test("search is an AND across terms, not an OR", async () => {
  await fixture();
  await reindex(Post);

  assert.deepEqual((await search(Post, "edge runtime").get()).map((p) => p.title), [
    "Edge runtime basics",
  ]);
  // "jobs" alone matches the queue post; paired with "edge" it matches nothing.
  assert.equal((await search(Post, "edge jobs").get()).length, 0);
});

test("search matches on prefix, so partial words still find a document", async () => {
  await fixture();
  await reindex(Post);
  assert.equal((await search(Post, "config").get())[0]?.title, "Runtime configuration");
});

test("an empty or punctuation-only query returns nothing rather than everything", async () => {
  await fixture();
  await reindex(Post);
  assert.deepEqual(await search(Post, "").get(), []);
  assert.deepEqual(await search(Post, "  ??  ").get(), []);
});

test("limit and offset page through hits", async () => {
  await fixture();
  await reindex(Post);

  const all = await search(Post, "runtime").ids();
  assert.ok(all.length >= 2);
  assert.deepEqual(await search(Post, "runtime").limit(1).ids(), [all[0]]);
  assert.deepEqual(await search(Post, "runtime").limit(1).offset(1).ids(), [all[1]]);
});

test("first() returns the best hit, or null when there is none", async () => {
  await fixture();
  await reindex(Post);
  assert.equal((await search(Post, "runtime").first())?.title, "Runtime configuration");
  assert.equal(await search(Post, "kubernetes").first(), null);
});

/* ------------------------------ staying in sync ---------------------------- */

test("registered models index on save and drop out on delete", async () => {
  await fixture();
  registerSearchable(Post);

  const post = new Post({ title: "Broadcasting", body: "WebSockets on the edge" });
  await post.save();
  assert.equal((await search(Post, "broadcasting").first())?.title, "Broadcasting");

  post.title = "Broadcasting, revised";
  post.body = "Durable Objects";
  await post.save();
  // Re-indexed, not appended: the stale body no longer matches.
  assert.equal(await search(Post, "websockets").first(), null);
  assert.ok(await search(Post, "durable").first());

  await post.delete();
  assert.equal(await search(Post, "durable").first(), null);
});

test("registering a model with no searchable fields is refused", async () => {
  await fixture();
  class Bare extends Model {
    static table = "bare";
  }
  assert.throws(() => registerSearchable(Bare as never), /no static searchable fields/);
});

test("reindex flushes first, so removed rows don't linger", async () => {
  const conn = await fixture();
  await reindex(Post);
  assert.ok(await search(Post, "queues").first());

  await conn.write("DELETE FROM posts WHERE title = ?", ["Queues and jobs"]);
  await reindex(Post);
  assert.equal(await search(Post, "queues").first(), null);
});

test("reindex pages through the table in chunks and counts what it wrote", async () => {
  await fixture();
  assert.equal(await reindex(Post, { chunk: 2 }), 3);
  assert.equal((await search(Post, "runtime").ids()).length, 2);
});

test("a hit whose row has since vanished is skipped, not returned as a hole", async () => {
  const conn = await fixture();
  await reindex(Post);
  // Delete the row behind the index without telling the driver.
  await conn.write("DELETE FROM posts WHERE title = ?", ["Runtime configuration"]);

  const hits = await search(Post, "runtime").get();
  assert.ok(hits.every((p) => p != null));
  assert.ok(!hits.some((p) => p.title === "Runtime configuration"));
});

/* ---------------------------- the database driver -------------------------- */

async function databaseFixture(): Promise<Connection> {
  const conn = await fixture(new DatabaseDriver() as never);
  await new Migrator(conn, "sqlite").up([searchMigration()]);
  return conn;
}

test("database driver: indexes and searches through SQLite FTS5", async () => {
  await databaseFixture();
  await reindex(Post);

  const hits = await search(Post, "runtime").get();
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((p) => p instanceof Post));
});

test("database driver: AND semantics and prefix matching, same as memory", async () => {
  await databaseFixture();
  await reindex(Post);

  assert.deepEqual((await search(Post, "edge runtime").get()).map((p) => p.title), [
    "Edge runtime basics",
  ]);
  assert.equal((await search(Post, "edge jobs").get()).length, 0);
  assert.equal((await search(Post, "config").get())[0]?.title, "Runtime configuration");
});

test("database driver: re-indexing a document replaces it rather than duplicating", async () => {
  await databaseFixture();
  await reindex(Post);

  const before = await search(Post, "runtime").ids();
  await reindex(Post);
  assert.deepEqual(await search(Post, "runtime").ids(), before);
});

test("database driver: quotes FTS5 syntax in user input instead of executing it", async () => {
  await databaseFixture();
  await reindex(Post);

  // Each of these is FTS5 syntax. They must be treated as words to search for,
  // not as operators — and above all must not throw a syntax error.
  for (const query of ['edge OR jobs', 'run"time', 'edge NEAR jobs', '"unbalanced', 'a*b']) {
    const hits = await search(Post, query).ids();
    assert.ok(Array.isArray(hits), `query ${JSON.stringify(query)} should not throw`);
  }
});

test("database driver: delete removes only the named documents", async () => {
  await databaseFixture();
  await reindex(Post);
  const [first, ...rest] = await search(Post, "runtime").ids();

  await searchDriver().delete("posts", [first!]);
  assert.deepEqual(await search(Post, "runtime").ids(), rest);
});

test("database driver: flush empties the index but leaves the rows alone", async () => {
  const conn = await databaseFixture();
  await reindex(Post);

  await searchDriver().flush("posts");
  assert.deepEqual(await search(Post, "runtime").ids(), []);
  assert.equal(((await conn.select("SELECT * FROM posts", [])) as Row[]).length, 3);
});

test("database driver: indexes are isolated from each other", async () => {
  await databaseFixture();
  await reindex(Post);

  await searchDriver().index("other", [{ id: "1", fields: { t: "runtime elsewhere" } }]);
  assert.deepEqual(await searchDriver().search("other", "runtime"), [
    { id: "1", score: (await searchDriver().search("other", "runtime"))[0]!.score },
  ]);
  // The posts index is unaffected by the other one's document.
  assert.ok(!(await search(Post, "elsewhere").ids()).length);
});
