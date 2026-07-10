import { test } from "node:test";
import assert from "node:assert/strict";

import { Migrator, SchemaBuilder, type Migration } from "../src/core/migrations.js";
import type { Connection } from "../src/core/database.js";

/** A fake connection that actually tracks the migrations table in memory. */
function fakeDb() {
  const applied = new Map<string, number>();
  const writes: string[] = [];
  const conn = {
    select: async (sql: string) => {
      if (sql.includes("MAX(batch)")) {
        const b = applied.size ? Math.max(...applied.values()) : null;
        return [{ b }];
      }
      if (sql.includes("WHERE batch")) {
        const b = applied.size ? Math.max(...applied.values()) : 0;
        return [...applied].filter(([, batch]) => batch === b).map(([name]) => ({ name }));
      }
      if (sql.includes("FROM migrations")) {
        return [...applied.keys()].map((name) => ({ name }));
      }
      return [];
    },
    write: async (sql: string, bindings: unknown[]) => {
      writes.push(sql);
      if (sql.startsWith("INSERT INTO migrations")) {
        applied.set(String(bindings[0]), Number(bindings[1]));
      } else if (sql.startsWith("DELETE FROM migrations")) {
        applied.delete(String(bindings[0]));
      }
      return { rowsAffected: 1 };
    },
  } as Connection;
  return { conn, writes, applied };
}

const migrations: Migration[] = [
  {
    name: "01_create_users",
    up: (s) =>
      s.createTable("users", (t) => {
        t.id();
        t.string("email").unique();
        t.boolean("active").default(true);
        t.timestamps();
      }),
    down: (s) => s.dropTable("users"),
  },
];

test("migrator runs pending, is idempotent, and rolls back", async () => {
  const { conn, writes, applied } = fakeDb();
  const migrator = new Migrator(conn, "sqlite");

  const up = await migrator.up(migrations);
  assert.deepEqual(up, ["01_create_users"]);
  assert.ok(writes.some((w) => w.startsWith("CREATE TABLE users")));
  assert.ok(writes.some((w) => w.includes("email VARCHAR(255) NOT NULL UNIQUE")));
  assert.equal(applied.size, 1);

  // running again is a no-op
  assert.deepEqual(await migrator.up(migrations), []);

  // rollback removes it and runs down()
  const down = await migrator.down(migrations);
  assert.deepEqual(down, ["01_create_users"]);
  assert.ok(writes.includes("DROP TABLE IF EXISTS users"));
  assert.equal(applied.size, 0);
});

test("schema builder emits dialect-aware SQL", async () => {
  const sqls: string[] = [];
  const conn = {
    select: async () => [],
    write: async (sql: string) => {
      sqls.push(sql);
      return { rowsAffected: 0 };
    },
  } as Connection;

  const schema = new SchemaBuilder(conn, "postgres");
  await schema.createTable("posts", (t) => {
    t.id();
    t.string("title");
    t.boolean("published").default(false);
    t.integer("views").nullable();
  });

  assert.match(sqls[0]!, /id SERIAL PRIMARY KEY/);
  assert.match(sqls[0]!, /title VARCHAR\(255\) NOT NULL/);
  assert.match(sqls[0]!, /published BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sqls[0]!, /views INTEGER/);
});
