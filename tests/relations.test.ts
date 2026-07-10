import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { setConnection, type Connection, type Row } from "../src/core/database.js";

class User extends Model {
  static table = "users";
  declare id: number;
  declare name: string;
  posts() {
    return this.hasMany(Post);
  }
  profile() {
    return this.hasOne(Profile);
  }
  roles() {
    return this.belongsToMany(Role);
  }
}

class Post extends Model {
  static table = "posts";
  declare id: number;
  declare user_id: number;
  declare title: string;
  author() {
    return this.belongsTo(User);
  }
}

class Profile extends Model {
  static table = "profiles";
  declare user_id: number;
}

class Role extends Model {
  static table = "roles";
  declare id: number;
}

/**
 * A mock connection that answers each query from a table -> rows map, and
 * records the SQL so we can assert on the queries a relation runs.
 */
function mock(tables: Record<string, Row[]>) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const conn = {
    select: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
      return tables[table] ?? [];
    },
    write: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rowsAffected: 1, insertId: 99 };
    },
  } as Connection;
  return { conn, calls };
}

test("hasMany loads children by foreign key", async () => {
  const { conn, calls } = mock({
    posts: [
      { id: 1, user_id: 5, title: "A" },
      { id: 2, user_id: 5, title: "B" },
    ],
  });
  setConnection(conn, "sqlite");

  const user = new User({ id: 5 });
  const posts = await user.posts();

  assert.equal(posts.length, 2);
  assert.ok(posts[0] instanceof Post);
  assert.equal(calls[0]!.sql, "SELECT * FROM posts WHERE user_id = ?");
  assert.deepEqual(calls[0]!.bindings, [5]);
});

test("hasOne loads a single related row or null", async () => {
  setConnection(mock({ profiles: [{ id: 3, user_id: 5 }] }).conn, "sqlite");
  const profile = await new User({ id: 5 }).profile();
  assert.ok(profile instanceof Profile);

  setConnection(mock({ profiles: [] }).conn, "sqlite");
  assert.equal(await new User({ id: 5 }).profile(), null);
});

test("belongsTo loads the owner by its key", async () => {
  const { conn, calls } = mock({ users: [{ id: 5, name: "Ada" }] });
  setConnection(conn, "sqlite");

  const author = await new Post({ id: 1, user_id: 5 }).author();
  assert.ok(author instanceof User);
  assert.equal(author!.name, "Ada");
  assert.equal(calls[0]!.sql, "SELECT * FROM users WHERE id = ? LIMIT 1");
  assert.deepEqual(calls[0]!.bindings, [5]);
});

test("belongsTo short-circuits to null without a foreign key", async () => {
  const { conn, calls } = mock({});
  setConnection(conn, "sqlite");
  assert.equal(await new Post({ id: 1 }).author(), null);
  assert.equal(calls.length, 0);
});

test("belongsToMany reads through the pivot table", async () => {
  const { conn, calls } = mock({
    role_user: [
      { user_id: 5, role_id: 10 },
      { user_id: 5, role_id: 11 },
    ],
    roles: [{ id: 10 }, { id: 11 }],
  });
  setConnection(conn, "sqlite");

  const roles = await new User({ id: 5 }).roles();
  assert.equal(roles.length, 2);
  assert.ok(roles[0] instanceof Role);
  assert.match(calls[0]!.sql, /FROM role_user WHERE user_id = \?/);
  assert.match(calls[1]!.sql, /FROM roles WHERE id IN \(\?, \?\)/);
  assert.deepEqual(calls[1]!.bindings, [10, 11]);
});

test("belongsToMany attach / detach write the pivot table", async () => {
  const { conn, calls } = mock({});
  setConnection(conn, "sqlite");

  const rel = new User({ id: 5 }).roles();
  await rel.attach(10);
  assert.match(calls[0]!.sql, /INSERT INTO role_user/);
  assert.deepEqual(calls[0]!.bindings, [5, 10]);

  await rel.detach(10);
  assert.match(calls[1]!.sql, /DELETE FROM role_user WHERE user_id = \? AND role_id = \?/);
});

test("load eager-loads hasMany with a single whereIn (no N+1)", async () => {
  const { conn, calls } = mock({
    posts: [
      { id: 1, user_id: 5, title: "A" },
      { id: 2, user_id: 6, title: "B" },
      { id: 3, user_id: 5, title: "C" },
    ],
  });
  setConnection(conn, "sqlite");

  const users = [new User({ id: 5 }), new User({ id: 6 }), new User({ id: 7 })];
  await User.load(users, "posts");

  // one query for all three parents
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /FROM posts WHERE user_id IN \(\?, \?, \?\)/);
  assert.deepEqual(calls[0]!.bindings, [5, 6, 7]);

  assert.equal((users[0]!.getRelation<Post[]>("posts") ?? []).length, 2);
  assert.equal((users[1]!.getRelation<Post[]>("posts") ?? []).length, 1);
  assert.deepEqual(users[2]!.getRelation("posts"), []); // no matches -> empty
});

test("loaded relations serialize through toJSON and stay out of save()", async () => {
  const { conn, calls } = mock({ posts: [{ id: 1, user_id: 5, title: "A" }] });
  setConnection(conn, "sqlite");

  const users = [new User({ id: 5, name: "Ada" })];
  await User.load(users, "posts");

  const json = users[0]!.toJSON();
  assert.equal((json.posts as Row[]).length, 1);
  assert.equal((json.posts as Row[])[0]!.title, "A");

  // save() must not try to persist the relation as a column
  await users[0]!.save();
  const update = calls.at(-1)!;
  assert.match(update.sql, /^UPDATE users SET/);
  assert.doesNotMatch(update.sql, /posts/);
});

test("load throws on an unknown relation name", async () => {
  setConnection(mock({}).conn, "sqlite");
  await assert.rejects(
    () => User.load([new User({ id: 1 })], "nope"),
    /has no relation "nope"/,
  );
});
