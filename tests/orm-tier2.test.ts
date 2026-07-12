import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { Application } from "../src/core/application.js";
import { Model } from "../src/core/model.js";
import { registerMorphType } from "../src/core/relations.js";
import { SchemaBuilder } from "../src/core/migrations.js";
import {
  db,
  setConnection,
  clearConnections,
  getConnection,
  type Connection,
  type Row,
} from "../src/core/database.js";

function connect(): DatabaseSync {
  new Application();
  clearConnections();
  const database = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return database.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = database.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  return database;
}

function schema(): SchemaBuilder {
  const { connection, dialect } = getConnection();
  return new SchemaBuilder(connection, dialect);
}

/* ------------------------------- migrations ------------------------------- */

test("createTable builds indexes and foreign keys; alterTable adds/renames/drops", async () => {
  const raw = connect();
  const s = schema();

  await s.createTable("teams", (t) => {
    t.id();
    t.string("name");
    t.index("name");
  });
  await s.createTable("members", (t) => {
    t.id();
    t.integer("team_id");
    t.string("email");
    t.uniqueIndex("email");
    t.foreign("team_id").references("id").on("teams");
  });

  // Indexes actually exist.
  const indexes = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('teams','members')")
    .all()
    .map((r) => (r as Row).name);
  assert.ok(indexes.some((n) => String(n).includes("teams_name")));
  assert.ok(indexes.some((n) => String(n).includes("members_email_unique")));

  // Add a column, use it, rename it, drop it.
  await s.alterTable("teams", (t) => {
    t.string("slug").nullable();
    t.index("slug");
  });
  await db("teams").insert({ name: "Rockets", slug: "rockets" });
  assert.equal((await db("teams").where("slug", "rockets").first())!.name, "Rockets");

  await s.alterTable("teams", (t) => t.renameColumn("name", "title"));
  const renamed = await db("teams").first();
  assert.ok(renamed && "title" in renamed && !("name" in renamed));

  await s.alterTable("teams", (t) => {
    t.dropIndex("teams_slug_index"); // drop the index before its column
    t.dropColumn("slug");
  });
  const dropped = await db("teams").first();
  assert.ok(dropped && !("slug" in dropped));
});

/* ----------------------------- query builder ------------------------------ */

async function seedUsers(): Promise<void> {
  const s = schema();
  await s.createTable("users", (t) => {
    t.id();
    t.string("name");
    t.integer("score");
    t.integer("bonus");
  });
  await s.createTable("posts", (t) => {
    t.id();
    t.integer("user_id");
    t.string("title");
  });
  await db("users").insert({ name: "Ada", score: 10, bonus: 5 });
  await db("users").insert({ name: "Bob", score: 3, bonus: 8 });
  await db("posts").insert({ user_id: 1, title: "Hello" });
  await db("posts").insert({ user_id: 1, title: "World" });
}

test("join + select pulls columns across tables", async () => {
  connect();
  await seedUsers();
  const rows = await db("posts").join("users", "posts.user_id", "users.id").select("posts.title", "users.name").get();
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.name, "Ada");
});

test("groupBy + having, distinct, and aggregates", async () => {
  connect();
  await seedUsers();
  await db("posts").insert({ user_id: 2, title: "Solo" });

  const grouped = await db("posts").select("user_id").groupBy("user_id").having("COUNT(*)", ">", 1).get();
  assert.deepEqual(grouped.map((r) => r.user_id), [1]); // only user 1 has >1 post

  const distinctScores = await db("users").distinct().select("score").pluck("score");
  assert.equal(new Set(distinctScores).size, distinctScores.length);
});

test("increment / decrement adjust columns atomically", async () => {
  connect();
  await seedUsers();
  await db("users").where("id", 1).increment("score", 5);
  assert.equal(await db("users").where("id", 1).value("score"), 15);
  await db("users").where("id", 1).decrement("score", 3, { bonus: 99 });
  assert.equal(await db("users").where("id", 1).value("score"), 12);
  assert.equal(await db("users").where("id", 1).value("bonus"), 99);
});

test("whereColumn, whereRaw, orderByRaw, and when", async () => {
  connect();
  await seedUsers();

  const higher = await db("users").whereColumn("score", ">", "bonus").pluck("name");
  assert.deepEqual(higher, ["Ada"]);

  const raw = await db("users").whereRaw("score >= ?", [10]).pluck("name");
  assert.deepEqual(raw, ["Ada"]);

  const ordered = await db("users").orderByRaw("score ASC").pluck("name");
  assert.deepEqual(ordered, ["Bob", "Ada"]);

  const filtered = await db("users").when(true, (q) => q.where("id", 2)).pluck("name");
  assert.deepEqual(filtered, ["Bob"]);
  const unfiltered = await db("users").when(false, (q) => q.where("id", 2)).pluck("name");
  assert.equal(unfiltered.length, 2);
});

test("upsert updates on conflict; insertOrIgnore skips duplicates; chunk pages", async () => {
  connect();
  await seedUsers();

  await db("users").upsert([{ id: 1, name: "Ada Lovelace", score: 10, bonus: 5 }], ["id"], ["name"]);
  assert.equal(await db("users").where("id", 1).value("name"), "Ada Lovelace");

  await db("users").insertOrIgnore({ id: 1, name: "Dup", score: 0, bonus: 0 });
  assert.equal(await db("users").where("id", 1).value("name"), "Ada Lovelace"); // unchanged

  const seen: unknown[] = [];
  await db("users")
    .orderBy("id")
    .chunk(1, (rows) => {
      seen.push(...rows.map((r) => r.id));
    });
  assert.deepEqual(seen, [1, 2]);
});

/* ------------------------------ polymorphic ------------------------------- */

class Post extends Model {
  static override table = "posts_m";
  declare id: number;
  declare title: string;
  comments() {
    return this.morphMany(Comment, "commentable");
  }
}
class Video extends Model {
  static override table = "videos_m";
  declare id: number;
  declare title: string;
  comments() {
    return this.morphMany(Comment, "commentable");
  }
}
class Comment extends Model {
  static override table = "comments_m";
  declare id: number;
  declare body: string;
  declare commentable_id: number;
  declare commentable_type: string;
  commentable() {
    return this.morphTo("commentable");
  }
}
registerMorphType("Post", Post);
registerMorphType("Video", Video);

test("morphMany / morphTo link and resolve across types", async () => {
  connect();
  const s = schema();
  await s.createTable("posts_m", (t) => {
    t.id();
    t.string("title");
  });
  await s.createTable("videos_m", (t) => {
    t.id();
    t.string("title");
  });
  await s.createTable("comments_m", (t) => {
    t.id();
    t.integer("commentable_id");
    t.string("commentable_type");
    t.string("body");
  });

  const post = await Post.create({ title: "A post" });
  const video = await Video.create({ title: "A video" });
  await post.comments().create({ body: "on post" });
  await video.comments().create({ body: "on video" });

  const postComments = await post.comments().get();
  assert.equal(postComments.length, 1);
  assert.equal(postComments[0]!.commentable_type, "Post");

  // morphTo resolves the owner back to the right class.
  const owner = await postComments[0]!.commentable();
  assert.ok(owner instanceof Post);
  assert.equal((owner as Post).title, "A post");

  // Eager loading a morphTo across mixed types.
  const allComments = await Comment.all();
  await Model.load(allComments, "commentable");
  const owners = allComments.map((c) => c.getRelation<Model>("commentable"));
  assert.ok(owners.some((o) => o instanceof Post));
  assert.ok(owners.some((o) => o instanceof Video));
});
