import { test } from "node:test";
import assert from "node:assert/strict";

import {
  db,
  connection,
  setConnection,
  addConnection,
  clearConnections,
  transaction,
  inTransaction,
  type Connection,
  type TransactionConnection,
  type Row,
} from "../src/core/database.js";

/* -------------------------------- fixtures -------------------------------- */

/** A connection that records every statement it runs. */
function recorder(rows: Row[] = []) {
  const sql: string[] = [];

  const conn: Connection = {
    async select(text) {
      sql.push(text);
      return rows;
    },
    async write(text) {
      sql.push(text);
      return { rowsAffected: 1 };
    },
  };

  return { conn, sql };
}

/**
 * A pool: every statement goes to a *different* connection unless one has been
 * checked out. This is the whole reason `begin()` exists — see the test below.
 */
function pool() {
  const sql: { statement: string; connection: number }[] = [];
  let next = 1;

  const checkout = (id: number) => ({
    async select(text: string) {
      sql.push({ statement: text, connection: id });
      return [] as Row[];
    },
    async write(text: string) {
      sql.push({ statement: text, connection: id });
      return { rowsAffected: 1 };
    },
  });

  let released = 0;

  const conn: Connection = {
    // Without a transaction, each statement lands on a fresh connection.
    select: (text) => checkout(next++).select(text),
    write: (text) => checkout(next++).write(text),

    async begin(): Promise<TransactionConnection> {
      const id = next++;
      const held = checkout(id);
      await held.write("BEGIN");

      return {
        select: held.select,
        write: held.write,
        async commit() {
          await held.write("COMMIT");
          released++;
        },
        async rollback() {
          await held.write("ROLLBACK");
          released++;
        },
      };
    },
  };

  return { conn, sql, releases: () => released };
}

/* ------------------------------- committing ------------------------------- */

test("a transaction commits when the callback returns", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  const result = await transaction(async () => {
    await db("orders").insert({ id: 1 });
    return "done";
  });

  assert.equal(result, "done");
  assert.deepEqual(
    sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "COMMIT"],
  );

  clearConnections();
});

test("a throw rolls back — and the error still reaches the caller", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  await assert.rejects(
    () =>
      transaction(async () => {
        await db("orders").insert({ id: 1 });
        throw new Error("payment declined");
      }),
    /payment declined/,
  );

  // The whole point: the insert is undone, and nothing is committed.
  assert.deepEqual(
    sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "ROLLBACK"],
  );
  assert.ok(!sql.includes("COMMIT"));

  clearConnections();
});

test("tx.rollback() abandons the transaction without committing", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  const result = await transaction(async (tx) => {
    await tx.table("orders").insert({ id: 1 });
    await tx.rollback();
    return "abandoned";
  });

  assert.equal(result, "abandoned");
  assert.deepEqual(
    sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "ROLLBACK"],
  );
  assert.ok(!sql.includes("COMMIT"), "an explicit rollback must not then commit");

  clearConnections();
});

/* -------------------------------- ambient --------------------------------- */

test("db() inside a transaction uses the transaction, without being handed it", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  assert.equal(inTransaction(), false);

  await transaction(async () => {
    assert.equal(inTransaction(), true);

    // No `tx` passed anywhere — this is the ambient part.
    await db("orders").insert({ id: 1 });
    await connection().write("UPDATE stock SET count = count - 1", []);
  });

  assert.equal(inTransaction(), false, "the transaction is gone once it commits");
  assert.deepEqual(
    sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "UPDATE", "COMMIT"],
  );

  clearConnections();
});

test("concurrent transactions don't steal each other's connection", async () => {
  // Two connections, each with its own transaction, running interleaved.
  const a = recorder();
  const b = recorder();
  setConnection(a.conn, "sqlite");
  addConnection("other", b.conn, "sqlite");

  await Promise.all([
    transaction(async () => {
      await new Promise((r) => setTimeout(r, 10));
      await db("orders").insert({ id: 1 });
    }),
    transaction(async () => {
      await db("events", "other").insert({ id: 2 });
    }, "other"),
  ]);

  // Each transaction's writes went to its own connection — AsyncLocalStorage,
  // not a module global, is what keeps these apart.
  assert.deepEqual(
    a.sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "COMMIT"],
  );
  assert.deepEqual(
    b.sql.map((s) => s.split(" ")[0]),
    ["BEGIN", "INSERT", "COMMIT"],
  );

  clearConnections();
});

test("a query outside a transaction is untouched", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  await db("orders").insert({ id: 1 });

  assert.deepEqual(
    sql.map((s) => s.split(" ")[0]),
    ["INSERT"],
  );

  clearConnections();
});

/* -------------------------------- nesting --------------------------------- */

test("a nested transaction takes a savepoint, not a second transaction", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  await transaction(async () => {
    await db("orders").insert({ id: 1 });

    await transaction(async () => {
      await db("items").insert({ id: 2 });
    });

    await db("audit").insert({ id: 3 });
  });

  assert.deepEqual(sql, [
    "BEGIN",
    "INSERT INTO orders (id) VALUES (?)",
    "SAVEPOINT keel_sp_1",
    "INSERT INTO items (id) VALUES (?)",
    "RELEASE SAVEPOINT keel_sp_1",
    "INSERT INTO audit (id) VALUES (?)",
    "COMMIT",
  ]);

  clearConnections();
});

test("an inner failure rolls back only the inner work; the outer carries on", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  await transaction(async () => {
    await db("orders").insert({ id: 1 });

    // A nested helper blows up. Without savepoints this would abandon the outer
    // transaction's insert too — silently.
    await assert.rejects(
      () =>
        transaction(async () => {
          await db("items").insert({ id: 2 });
          throw new Error("out of stock");
        }),
      /out of stock/,
    );

    await db("audit").insert({ id: 3 });
  });

  assert.deepEqual(sql, [
    "BEGIN",
    "INSERT INTO orders (id) VALUES (?)",
    "SAVEPOINT keel_sp_1",
    "INSERT INTO items (id) VALUES (?)",
    "ROLLBACK TO SAVEPOINT keel_sp_1",
    "INSERT INTO audit (id) VALUES (?)",
    "COMMIT", // the outer transaction still commits
  ]);

  clearConnections();
});

test("savepoints nest as deep as you like", async () => {
  const { conn, sql } = recorder();
  setConnection(conn, "sqlite");

  await transaction(async (outer) => {
    assert.equal(outer.depth, 0);

    await transaction(async (mid) => {
      assert.equal(mid.depth, 1);

      await transaction(async (inner) => {
        assert.equal(inner.depth, 2);
      });
    });
  });

  assert.deepEqual(sql, [
    "BEGIN",
    "SAVEPOINT keel_sp_1",
    "SAVEPOINT keel_sp_2",
    "RELEASE SAVEPOINT keel_sp_2",
    "RELEASE SAVEPOINT keel_sp_1",
    "COMMIT",
  ]);

  clearConnections();
});

/* --------------------------------- pooling -------------------------------- */

test("a pooled driver runs the whole transaction on ONE checked-out connection", async () => {
  const { conn, sql, releases } = pool();
  setConnection(conn, "postgres");

  await transaction(async () => {
    await db("orders").insert({ id: 1 });
    await db("stock").where("id", 1).update({ count: 0 });
  });

  // This is the bug the begin() seam exists to prevent: every statement of the
  // transaction must land on the SAME connection. If BEGIN were issued through
  // the pool, these ids would differ and the transaction would wrap nothing.
  const ids = new Set(sql.map((s) => s.connection));
  assert.equal(ids.size, 1, `expected one connection, saw ${[...ids].join(", ")}`);

  assert.deepEqual(
    sql.map((s) => s.statement.split(" ")[0]),
    ["BEGIN", "INSERT", "UPDATE", "COMMIT"],
  );
  assert.equal(releases(), 1, "the connection goes back to the pool");

  clearConnections();
});

test("without a transaction, a pool is free to spread statements around", async () => {
  const { conn, sql } = pool();
  setConnection(conn, "postgres");

  await db("orders").insert({ id: 1 });
  await db("orders").insert({ id: 2 });

  // Two statements, two connections — which is exactly why the above matters.
  assert.equal(new Set(sql.map((s) => s.connection)).size, 2);

  clearConnections();
});

test("a pooled connection is released even when the commit throws", async () => {
  let released = false;

  const conn: Connection = {
    async select() {
      return [];
    },
    async write() {
      return { rowsAffected: 0 };
    },
    async begin(): Promise<TransactionConnection> {
      return {
        async select() {
          return [];
        },
        async write() {
          return { rowsAffected: 0 };
        },
        async commit() {
          released = true; // the `finally` in the real adapter
          throw new Error("commit failed");
        },
        async rollback() {
          released = true;
        },
      };
    },
  };

  setConnection(conn, "postgres");

  await assert.rejects(() => transaction(async () => {}), /commit failed/);
  assert.equal(released, true, "the connection must not leak");

  clearConnections();
});

/* ---------------------------------- D1 ------------------------------------ */

test("a driver that cannot do transactions says so, rather than failing cryptically", async () => {
  const conn: Connection = {
    async select() {
      return [];
    },
    async write() {
      return { rowsAffected: 0 };
    },
    async begin(): Promise<never> {
      throw new Error("D1 does not support interactive transactions.");
    },
  };

  setConnection(conn, "sqlite");

  await assert.rejects(
    () => transaction(async () => {}),
    /does not support interactive transactions/,
  );

  clearConnections();
});
