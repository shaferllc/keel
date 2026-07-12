import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { Model } from "../src/core/model.js";
import { setConnection, clearConnections, type Connection, type Row } from "../src/core/database.js";
import { clearModelHooks } from "../src/core/model-events.js";

/* --------------------------------- models --------------------------------- */

class User extends Model {
  static override table = "users";
  declare id: number;
  declare name: string;
  declare email: string;
  declare active: number;
  posts() {
    return this.hasMany(Post);
  }
  roles() {
    return this.belongsToMany(Role);
  }
}
class Post extends Model {
  static override table = "posts";
  declare id: number;
  declare user_id: number;
  declare title: string;
  declare published: number;
  comments() {
    return this.hasMany(Comment);
  }
  author() {
    return this.belongsTo(User);
  }
}
class Comment extends Model {
  static override table = "comments";
  declare id: number;
  declare post_id: number;
  declare body: string;
}
class Role extends Model {
  static override table = "roles";
  declare id: number;
  declare name: string;
}
class Widget extends Model {
  static override table = "widgets";
  declare id: number;
  declare name: string;
  declare slug: string;
}
class SoftUser extends Model {
  static override table = "soft_users";
  static override softDeletes = true;
  static override casts = { deleted_at: "date" } as const;
  declare id: number;
  declare name: string;
  declare deleted_at: Date | null;
}
class Account extends Model {
  static override table = "users";
  static override hidden = ["email"];
  static override appends = ["initials", "label"];
  declare id: number;
  declare name: string;
  declare email: string;
  get initials(): string {
    return (this.name ?? "").slice(0, 2).toUpperCase();
  }
  label(): string {
    return `#${this.id} ${this.name}`;
  }
}

async function setup(): Promise<DatabaseSync> {
  new Application();
  clearConnections();
  const db = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return db.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = db.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, active INTEGER)");
  db.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, published INTEGER)");
  db.exec("CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, body TEXT)");
  db.exec("CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
  db.exec("CREATE TABLE role_user (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role_id INTEGER)");
  db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT)");
  db.exec("CREATE TABLE soft_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, deleted_at DATETIME)");
  return db;
}

// A minimal active Application so events()/instrumentation have somewhere to fire.
import { Application } from "../src/core/application.js";

/* --------------------------------- events --------------------------------- */

test("lifecycle events fire in order, can mutate, and can veto the write", async () => {
  await setup();
  clearModelHooks(Widget);
  const log: string[] = [];
  Widget.saving(() => void log.push("saving"));
  Widget.creating((w) => {
    w.slug = w.name.toLowerCase();
    log.push("creating");
  });
  Widget.created(() => void log.push("created"));
  Widget.saved(() => void log.push("saved"));

  const w = await Widget.create({ name: "Foo" });
  assert.equal(w.slug, "foo"); // mutated by the creating hook
  assert.deepEqual(log, ["saving", "creating", "created", "saved"]);

  log.length = 0;
  Widget.updating(() => void log.push("updating"));
  Widget.updated(() => void log.push("updated"));
  w.name = "Bar";
  await w.save();
  assert.deepEqual(log, ["saving", "updating", "updated", "saved"]);

  clearModelHooks(Widget);
});

test("a *ing hook returning false vetoes the write", async () => {
  await setup();
  clearModelHooks(Widget);
  Widget.creating(() => false);
  const w = await Widget.create({ name: "X" });
  assert.equal(w.id, undefined);
  assert.equal(await Widget.query().count(), 0);
  clearModelHooks(Widget);
});

test("observe() attaches an observer object's methods as hooks", async () => {
  await setup();
  clearModelHooks(Widget);
  const seen: string[] = [];
  Widget.observe({
    creating: () => void seen.push("creating"),
    deleting: () => void seen.push("deleting"),
  });
  const w = await Widget.create({ name: "Z" });
  await w.delete();
  assert.deepEqual(seen, ["creating", "deleting"]);
  clearModelHooks(Widget);
});

/* ----------------------------- serialization ------------------------------ */

test("toJSON honors hidden and appended accessors/methods", async () => {
  await setup();
  await Account.create({ name: "Ada", email: "ada@x.com" });
  const account = (await Account.first())!;
  const json = account.toJSON();
  assert.equal(json.email, undefined); // hidden
  assert.equal(json.name, "Ada");
  assert.equal(json.initials, "AD"); // appended getter
  assert.equal(json.label, `#${account.id} Ada`); // appended method
});

test("visible acts as an allowlist that wins over everything else", async () => {
  await setup();
  class Slim extends Model {
    static override table = "users";
    static override visible = ["id", "name"];
    declare id: number;
    declare name: string;
    declare email: string;
  }
  await Slim.create({ name: "Grace", email: "g@x.com" });
  const json = (await Slim.first())!.toJSON();
  assert.deepEqual(Object.keys(json).sort(), ["id", "name"]);
});

/* ------------------------------ soft deletes ------------------------------ */

test("soft delete hides the row, keeps it in the table, and can be restored", async () => {
  const db = await setup();
  const u = await SoftUser.create({ name: "Ann" });
  await u.delete();

  assert.equal(u.trashed(), true);
  assert.equal(await SoftUser.find(u.id), null); // excluded by the scope
  assert.equal(db.prepare("SELECT COUNT(*) c FROM soft_users").get()!.c, 1); // still there

  const withTrashed = await SoftUser.withTrashed().where("id", u.id).first();
  assert.equal(withTrashed!.name, "Ann");
  assert.equal((await SoftUser.onlyTrashed().get()).length, 1);

  await u.restore();
  assert.equal(u.trashed(), false);
  assert.equal((await SoftUser.findOrFail(u.id)).name, "Ann");
});

test("forceDelete removes the row for good", async () => {
  const db = await setup();
  const u = await SoftUser.create({ name: "Bob" });
  await u.forceDelete();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM soft_users").get()!.c, 0);
});

/* ------------------------------ global scopes ----------------------------- */

test("a global scope constrains every query the model builds", async () => {
  await setup();
  class ActiveUser extends Model {
    static override table = "users";
    declare id: number;
    declare active: number;
  }
  ActiveUser.addGlobalScope("active", (q) => q.where("active", 1));
  await User.create({ name: "on", active: 1 });
  await User.create({ name: "off", active: 0 });

  assert.equal((await ActiveUser.all()).length, 1);
  assert.equal(await ActiveUser.query().count(), 1);
});

/* ------------------------- relationship queries --------------------------- */

async function seedGraph(): Promise<{ u1: User; u2: User }> {
  const u1 = await User.create({ name: "Author", active: 1 });
  const u2 = await User.create({ name: "Lurker", active: 1 });
  const p1 = await Post.create({ user_id: u1.id, title: "Hello", published: 1 });
  await Post.create({ user_id: u1.id, title: "Draft", published: 0 });
  await Comment.create({ post_id: p1.id, body: "nice" });
  await Comment.create({ post_id: p1.id, body: "great" });
  const role = await Role.create({ name: "admin" });
  await u1.roles().attach(role.id);
  return { u1, u2 };
}

test("with() eager-loads nested relations, withCount() adds counts", async () => {
  await setup();
  await seedGraph();
  const users = await User.with("posts.comments").withCount("posts", "roles").orderBy("id").get();

  assert.equal((users[0] as Row).posts_count, 2);
  assert.equal((users[0] as Row).roles_count, 1);
  assert.equal((users[1] as Row).posts_count, 0);

  const posts = users[0]!.getRelation<Post[]>("posts")!;
  assert.equal(posts.length, 2);
  const firstPostComments = posts.find((p) => p.title === "Hello")!.getRelation<Comment[]>("comments")!;
  assert.equal(firstPostComments.length, 2); // nested load worked
});

test("whereHas / has / doesntHave filter by relationship existence", async () => {
  await setup();
  await seedGraph();

  const published = await User.whereHas("posts", (q) => q.where("published", 1)).get();
  assert.deepEqual(published.map((u) => u.name), ["Author"]);

  assert.deepEqual((await User.has("posts").get()).map((u) => u.name), ["Author"]);
  assert.deepEqual((await User.doesntHave("posts").get()).map((u) => u.name), ["Lurker"]);

  // A constraint that matches nothing yields no authors.
  const none = await User.whereHas("posts", (q) => q.where("title", "Nonexistent")).get();
  assert.equal(none.length, 0);

  // belongsToMany existence via the pivot.
  assert.deepEqual((await User.has("roles").get()).map((u) => u.name), ["Author"]);
});
