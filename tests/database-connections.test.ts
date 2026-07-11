import { test } from "node:test";
import assert from "node:assert/strict";

import {
  db,
  connection,
  setConnection,
  addConnection,
  setDefaultConnection,
  connectionNames,
  clearConnections,
  type Connection,
} from "../src/core/database.js";
import { Model } from "../src/core/model.js";

/** A fake connection that records every SQL string + bindings it runs. */
function spy(): Connection & { calls: { sql: string; bindings: unknown[] }[] } {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  return {
    calls,
    async select(sql, bindings) {
      calls.push({ sql, bindings });
      return [];
    },
    async write(sql, bindings) {
      calls.push({ sql, bindings });
      return { rowsAffected: 1 };
    },
  };
}

test("db(table, name) routes to the named connection and its dialect", async () => {
  clearConnections();
  const primary = spy();
  const reporting = spy();
  setConnection(primary, "sqlite");
  addConnection("reporting", reporting, "postgres");

  await db("users").where("id", 1).first();
  await db("events", "reporting").where("kind", "signup").first();

  assert.equal(primary.calls.length, 1);
  assert.equal(reporting.calls.length, 1);
  // sqlite keeps `?`; postgres rewrites to `$1`.
  assert.match(primary.calls[0]!.sql, /WHERE id = \?/);
  assert.match(reporting.calls[0]!.sql, /WHERE kind = \$1/);
});

test("connection(name) gives a reusable handle + raw select/write", async () => {
  clearConnections();
  const pg = spy();
  addConnection("reporting", pg, "postgres");

  const reporting = connection("reporting");
  assert.equal(reporting.dialect, "postgres");
  await reporting.table("events").where("a", 1).where("b", 2).get();
  await reporting.write("DELETE FROM events WHERE id = ?", [7]);

  assert.equal(pg.calls.length, 2);
  assert.match(pg.calls[0]!.sql, /WHERE a = \$1 AND b = \$2/); // dialect applied via handle
  assert.match(pg.calls[1]!.sql, /id = \$1/);
});

test("setDefaultConnection switches which connection db() uses", async () => {
  clearConnections();
  const a = spy();
  const b = spy();
  addConnection("a", a, "sqlite");
  addConnection("b", b, "sqlite");

  setDefaultConnection("b");
  await db("t").get();
  assert.equal(b.calls.length, 1);
  assert.equal(a.calls.length, 0);

  assert.deepEqual(connectionNames().sort(), ["a", "b"]);
  assert.throws(() => setDefaultConnection("nope"), /No database connection "nope"/);
});

test("a Model with static connection uses that connection", async () => {
  clearConnections();
  const main = spy();
  const analytics = spy();
  setConnection(main, "sqlite");
  addConnection("analytics", analytics, "sqlite");

  class Event extends Model {
    static table = "events";
    static connection = "analytics";
  }
  class User extends Model {
    static table = "users"; // default connection
  }

  await Event.all();
  await User.all();

  assert.equal(analytics.calls.length, 1);
  assert.match(analytics.calls[0]!.sql, /FROM events/);
  assert.equal(main.calls.length, 1);
  assert.match(main.calls[0]!.sql, /FROM users/);
});

test("an unregistered named connection rejects lazily, not at build time", async () => {
  clearConnections();
  setConnection(spy(), "sqlite");
  // Building the query must not throw…
  const query = db("x", "missing").where("id", 1);
  // …only running it rejects.
  await assert.rejects(() => query.get(), /No database connection "missing"/);
});
