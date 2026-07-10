import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { setConnection, type Connection } from "../src/core/database.js";
import { NotFoundException } from "../src/core/exceptions.js";

class User extends Model {
  static table = "users";
  declare id: number;
  declare email: string;
  declare name: string;
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

test("find hydrates a typed model", async () => {
  const { conn, calls } = mock([{ id: 1, email: "a@b.com", name: "Ada" }]);
  setConnection(conn, "sqlite");
  const user = await User.find(1);
  assert.ok(user instanceof User);
  assert.equal(user!.email, "a@b.com");
  assert.equal(calls[0]!.sql, "SELECT * FROM users WHERE id = ? LIMIT 1");
  assert.deepEqual(calls[0]!.bindings, [1]);
});

test("find returns null when missing; findOrFail throws", async () => {
  setConnection(mock([]).conn, "sqlite");
  assert.equal(await User.find(99), null);
  await assert.rejects(() => User.findOrFail(99), (e) => e instanceof NotFoundException);
});

test("all + where return model arrays", async () => {
  setConnection(mock([{ id: 1 }, { id: 2 }]).conn, "sqlite");
  const users = await User.all();
  assert.equal(users.length, 2);
  assert.ok(users[0] instanceof User);
  assert.equal((await User.where("active", true)).length, 2);
});

test("create inserts and returns a model with id", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const user = await User.create({ email: "a@b.com", name: "Ada" });
  assert.equal(user.id, 7);
  assert.equal(user.email, "a@b.com");
  assert.equal(calls[0]!.sql, "INSERT INTO users (email, name) VALUES (?, ?)");
});

test("save inserts when new, updates when existing", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const u = new User({ email: "x@y.com" });
  await u.save();
  assert.equal(u.id, 7);
  assert.equal(calls[0]!.sql, "INSERT INTO users (email) VALUES (?)");

  u.name = "Grace";
  await u.save();
  assert.match(calls[1]!.sql, /^UPDATE users SET/);
  assert.match(calls[1]!.sql, /WHERE id = \?$/);
});

test("delete + fill + toJSON", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const u = new User({ id: 5, email: "a@b.com" });
  u.fill({ name: "Ada" });
  assert.equal(u.name, "Ada");
  assert.deepEqual(u.toJSON(), { id: 5, email: "a@b.com", name: "Ada" });

  await u.delete();
  assert.equal(calls[0]!.sql, "DELETE FROM users WHERE id = ?");
  assert.deepEqual(calls[0]!.bindings, [5]);
});
