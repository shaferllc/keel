import { test } from "node:test";
import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";

import { Migrator, SchemaBuilder, type Migration } from "../src/core/migrations.js";
import type { Connection, Row } from "../src/core/database.js";

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

/* ------------------------- reset & dropAllTables -------------------------- */

/** A real in-memory SQLite connection, so the schema changes are real. */
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

/** Three migrations, each applied in its own batch, each with a working down(). */
function threeTables(): Migration[] {
  return ["users", "posts", "comments"].map((table, i) => ({
    name: `0${i + 1}_create_${table}`,
    async up(schema: SchemaBuilder) {
      await schema.createTable(table, (t) => {
        t.id();
        t.string("label");
      });
    },
    async down(schema: SchemaBuilder) {
      await schema.dropTable(table);
    },
  }));
}

const tablesIn = async (conn: Connection): Promise<string[]> =>
  (
    (await conn.select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      [],
    )) as { name: string }[]
  )
    .map((r) => r.name)
    .sort();

test("migrator: reset rolls back every batch, newest first", async () => {
  const conn = sqliteConnection();
  const migrator = new Migrator(conn, "sqlite");
  const migrations = threeTables();

  // One batch per call, so there are three to unwind.
  for (const m of migrations) await migrator.up([m]);
  assert.deepEqual(await tablesIn(conn), ["comments", "migrations", "posts", "users"]);

  const rolled = await migrator.reset(migrations);
  assert.deepEqual(rolled, ["03_create_comments", "02_create_posts", "01_create_users"]);
  assert.deepEqual(await tablesIn(conn), ["migrations"]);
  assert.deepEqual(await migrator.ran(), []);
});

test("migrator: reset is a no-op on a database with nothing applied", async () => {
  const migrator = new Migrator(sqliteConnection(), "sqlite");
  assert.deepEqual(await migrator.reset(threeTables()), []);
});

test("migrator: reset can be followed by up, which is what migrate:refresh does", async () => {
  const conn = sqliteConnection();
  const migrator = new Migrator(conn, "sqlite");
  const migrations = threeTables();

  await migrator.up(migrations);
  await migrator.reset(migrations);
  const applied = await migrator.up(migrations);

  assert.deepEqual(applied, migrations.map((m) => m.name));
  assert.deepEqual(await tablesIn(conn), ["comments", "migrations", "posts", "users"]);
});

test("migrator: dropAllTables clears everything, migrations table included", async () => {
  const conn = sqliteConnection();
  const migrator = new Migrator(conn, "sqlite");

  await migrator.up(threeTables());
  const dropped = await migrator.dropAllTables();

  assert.deepEqual(dropped.sort(), ["comments", "migrations", "posts", "users"]);
  assert.deepEqual(await tablesIn(conn), []);
});

test("migrator: dropAllTables gets back to empty when a down() is broken", async () => {
  const conn = sqliteConnection();
  const migrator = new Migrator(conn, "sqlite");

  // The case migrate:fresh exists for: reset() can't finish, but fresh can.
  const broken: Migration[] = [
    {
      name: "01_create_users",
      async up(schema) {
        await schema.createTable("users", (t) => t.id());
      },
      async down() {
        throw new Error("this down() was never right");
      },
    },
  ];

  await migrator.up(broken);
  await assert.rejects(() => migrator.reset(broken), /never right/);

  await migrator.dropAllTables();
  assert.deepEqual(await tablesIn(conn), []);

  // And the database is genuinely reusable afterwards.
  assert.deepEqual(await migrator.up(broken), ["01_create_users"]);
});

test("migrator: dropAllTables on an untouched database is a no-op", async () => {
  const migrator = new Migrator(sqliteConnection(), "sqlite");
  assert.deepEqual(await migrator.dropAllTables(), []);
});

test("schema.raw rewrites ? to $n on postgres, and leaves it alone elsewhere", async () => {
  const seen: { sql: string; bindings: unknown[] }[] = [];
  const spy = {
    select: async () => [],
    write: async (sql: string, bindings: unknown[]) => {
      seen.push({ sql, bindings });
      return { rowsAffected: 0 };
    },
  } as Connection;

  const sql = "UPDATE users SET active = ?, role = ? WHERE id = ?";
  await new SchemaBuilder(spy, "postgres").raw(sql, [true, "admin", 1]);
  await new SchemaBuilder(spy, "sqlite").raw(sql, [true, "admin", 1]);

  assert.equal(seen[0]!.sql, "UPDATE users SET active = $1, role = $2 WHERE id = $3");
  assert.equal(seen[1]!.sql, sql); // sqlite/mysql take ? as-is
  // Bindings are passed straight through either way.
  assert.deepEqual(seen[0]!.bindings, [true, "admin", 1]);
});
