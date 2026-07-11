import { test } from "node:test";
import assert from "node:assert/strict";

import { d1Connection, type D1Like } from "../src/db/d1.js";
import { pgConnection, type PgLike } from "../src/db/pg.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";
import { db, setConnection, clearConnections } from "../src/core/database.js";

test("d1Connection: maps prepare/bind/all + run to select/write", async () => {
  const seen: { sql: string; bindings: unknown[]; kind: string }[] = [];
  const fake: D1Like = {
    prepare(sql) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              seen.push({ sql, bindings: values, kind: "all" });
              return { results: [{ id: 1, name: "Ada" }] as T[] };
            },
            async run() {
              seen.push({ sql, bindings: values, kind: "run" });
              return { meta: { changes: 1, last_row_id: 7 } };
            },
          };
        },
      };
    },
  };

  const conn = d1Connection(fake);
  assert.deepEqual(await conn.select("SELECT * FROM users WHERE id = ?", [1]), [
    { id: 1, name: "Ada" },
  ]);
  assert.deepEqual(await conn.write("INSERT INTO users (name) VALUES (?)", ["Ada"]), {
    rowsAffected: 1,
    insertId: 7,
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0]!.bindings, [1]);
});

test("pgConnection: maps query() to select/write, RETURNING id → insertId", async () => {
  const fake: PgLike = {
    async query(text, values) {
      if (text.startsWith("SELECT")) return { rows: [{ id: 5 }], rowCount: 1 };
      // Simulate an INSERT ... RETURNING id
      if (/returning/i.test(text)) return { rows: [{ id: 42 }], rowCount: 1 };
      return { rows: [], rowCount: 3 };
    },
  };
  const conn = pgConnection(fake);

  assert.deepEqual(await conn.select("SELECT * FROM users", []), [{ id: 5 }]);
  assert.deepEqual(await conn.write("INSERT INTO users (n) VALUES ($1) RETURNING id", ["x"]), {
    rowsAffected: 1,
    insertId: 42,
  });
  // No RETURNING → no insertId, rowsAffected from rowCount.
  assert.deepEqual(await conn.write("UPDATE users SET n = $1", ["x"]), {
    rowsAffected: 3,
    insertId: undefined,
  });
});

test("libsqlConnection: normalizes rows and coerces bigint lastInsertRowid", async () => {
  const fake: LibSqlLike = {
    async execute({ sql }) {
      if (sql.startsWith("SELECT")) {
        return { rows: [{ id: 1, name: "Grace" }], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1, lastInsertRowid: 99n };
    },
  };
  const conn = libsqlConnection(fake);

  const rows = await conn.select("SELECT * FROM users", []);
  assert.deepEqual(rows, [{ id: 1, name: "Grace" }]);
  assert.equal(Object.getPrototypeOf(rows[0]!), Object.prototype); // plain object

  assert.deepEqual(await conn.write("INSERT INTO users (name) VALUES (?)", ["Grace"]), {
    rowsAffected: 1,
    insertId: 99, // bigint → number
  });
});

test("an adapter threads end-to-end through the query builder", async () => {
  clearConnections();
  const captured: { sql: string; bindings: unknown[] }[] = [];
  const fake: D1Like = {
    prepare(sql) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              captured.push({ sql, bindings: values });
              return { results: [{ id: 3 }] as T[] };
            },
            async run() {
              captured.push({ sql, bindings: values });
              return { meta: { changes: 1, last_row_id: 3 } };
            },
          };
        },
      };
    },
  };
  setConnection(d1Connection(fake), "sqlite");

  const row = await db("users").where("id", 3).first();
  assert.deepEqual(row, { id: 3 });
  assert.match(captured[0]!.sql, /SELECT \* FROM users WHERE id = \? LIMIT 1/);
  assert.deepEqual(captured[0]!.bindings, [3]);
});
