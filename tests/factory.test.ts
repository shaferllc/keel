import { test } from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { Faker, factory, Seeder, seed } from "../src/core/factory.js";
import { setConnection, type Connection } from "../src/core/database.js";

class User extends Model {
  static table = "users";
  declare id: number;
  declare name: string;
  declare email: string;
}

function mock() {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  let nextId = 1;
  const conn = {
    select: async () => [],
    write: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rowsAffected: 1, insertId: nextId++ };
    },
  } as Connection;
  return { conn, calls };
}

test("faker is deterministic for a given seed", () => {
  const a = new Faker(123);
  const b = new Faker(123);
  assert.equal(a.name(), b.name());
  assert.equal(a.email(), b.email());
  assert.equal(a.number(1, 100), b.number(1, 100));

  // different seed diverges
  assert.notEqual(new Faker(1).uuid(), new Faker(2).uuid());
});

test("faker helpers stay within bounds and shape", () => {
  const f = new Faker(7);
  for (let i = 0; i < 50; i++) {
    const n = f.number(5, 10);
    assert.ok(n >= 5 && n <= 10, `number ${n} out of range`);
  }
  assert.match(f.email(), /^[a-z0-9.]+@[a-z.]+$/);
  assert.match(f.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(f.sentence(), /^[A-Z].*\.$/);
});

test("make builds an instance without persisting", () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");

  const user = factory(User, (f) => ({ name: f.name(), email: f.email() })).make();
  assert.ok(user instanceof User);
  assert.ok((user as User).name);
  assert.equal(calls.length, 0); // nothing written
});

test("make applies overrides", () => {
  setConnection(mock().conn, "sqlite");
  const user = factory(User, (f) => ({ name: f.name(), email: f.email() })).make({
    name: "Ada",
  });
  assert.equal((user as User).name, "Ada");
});

test("create persists a single model with a back-filled id", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");

  const user = (await factory(User, (f) => ({ name: f.name() })).create()) as User;
  assert.equal(user.id, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /^INSERT INTO users/);
});

test("count(n) produces n distinct persisted models", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");

  const users = (await factory(User, (f, i) => ({
    name: f.name(),
    email: `user${i}@x.com`,
  }))
    .count(3)
    .create()) as User[];

  assert.equal(users.length, 3);
  assert.deepEqual(
    users.map((u) => u.id),
    [1, 2, 3],
  );
  // the index reaches the definition
  assert.equal(users[0]!.email, "user0@x.com");
  assert.equal(users[2]!.email, "user2@x.com");
  assert.equal(calls.length, 3);
});

test("make with count returns an array", () => {
  setConnection(mock().conn, "sqlite");
  const users = factory(User, (f) => ({ name: f.name() })).count(2).make() as unknown as User[];
  assert.equal(users.length, 2);
});

test("seeders run and compose via call()", async () => {
  const { conn, calls } = mock();
  setConnection(conn, "sqlite");
  const order: string[] = [];

  class UserSeeder extends Seeder {
    async run() {
      order.push("users");
      await factory(User, (f) => ({ name: f.name() })).count(2).create();
    }
  }
  class DatabaseSeeder extends Seeder {
    async run() {
      order.push("database");
      await this.call([UserSeeder]);
    }
  }

  await seed(DatabaseSeeder);
  assert.deepEqual(order, ["database", "users"]);
  assert.equal(calls.length, 2); // the two users
});
