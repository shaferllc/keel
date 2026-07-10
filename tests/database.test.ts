import { test } from "node:test";
import assert from "node:assert/strict";
import { db, setConnection, type Connection } from "../src/core/database.js";

interface Call {
  sql: string;
  bindings: unknown[];
}

function mock(rows: unknown[] = [{ id: 1, name: "Ada" }]) {
  const calls: Call[] = [];
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

// Runs first, before any setConnection — exercises the guard.
test("throws without a connection", async () => {
  await assert.rejects(() => db("users").get(), /No database connection/);
});

test("select with where/order/limit (sqlite placeholders)", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const rows = await db("users")
    .where("active", true)
    .where("age", ">", 18)
    .orderBy("name")
    .limit(10)
    .get();
  assert.deepEqual(rows, [{ id: 1, name: "Ada" }]);
  assert.equal(
    calls[0]!.sql,
    "SELECT * FROM users WHERE active = ? AND age > ? ORDER BY name ASC LIMIT 10",
  );
  assert.deepEqual(calls[0]!.bindings, [true, 18]);
});

test("postgres placeholders", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "postgres");
  await db("users").where("id", 5).first();
  assert.equal(calls[0]!.sql, "SELECT * FROM users WHERE id = $1 LIMIT 1");
});

test("whereIn / orWhere / whereNull", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await db("posts").whereIn("id", [1, 2, 3]).orWhere("pinned", true).whereNull("deleted_at").get();
  assert.equal(
    calls[0]!.sql,
    "SELECT * FROM posts WHERE id IN (?, ?, ?) OR pinned = ? AND deleted_at IS NULL",
  );
  assert.deepEqual(calls[0]!.bindings, [1, 2, 3, true]);
});

test("insert / insertGetId", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const id = await db("users").insertGetId({ email: "a@b.com", name: "Ada" });
  assert.equal(id, 7);
  assert.equal(calls[0]!.sql, "INSERT INTO users (email, name) VALUES (?, ?)");
  assert.deepEqual(calls[0]!.bindings, ["a@b.com", "Ada"]);
});

test("update / delete", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  await db("users").where("id", 1).update({ name: "Grace" });
  assert.equal(calls[0]!.sql, "UPDATE users SET name = ? WHERE id = ?");
  assert.deepEqual(calls[0]!.bindings, ["Grace", 1]);

  await db("users").where("id", 2).delete();
  assert.equal(calls[1]!.sql, "DELETE FROM users WHERE id = ?");
  assert.deepEqual(calls[1]!.bindings, [2]);
});

test("count / exists", async () => {
  const { conn, calls } = mock([{ count: 3 }]);
  setConnection(conn, "sqlite");
  assert.equal(await db("users").where("active", true).count(), 3);
  assert.equal(calls[0]!.sql, "SELECT COUNT(*) AS count FROM users WHERE active = ?");
  assert.equal(await db("users").exists(), true);
});
