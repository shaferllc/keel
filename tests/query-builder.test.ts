import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { Application } from "../src/core/application.js";
import {
  db,
  setConnection,
  clearConnections,
  type Connection,
  type Row,
} from "../src/core/database.js";
import { NotFoundException } from "../src/core/exceptions.js";

function seed(): DatabaseSync {
  new Application();
  clearConnections();
  const database = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return database.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = database.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  database.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price INTEGER, category TEXT, active INTEGER)",
  );
  const rows: [string, number, string, number][] = [
    ["a-cheap", 5, "a", 1],
    ["a-dear", 50, "a", 1],
    ["b-cheap", 8, "b", 0],
    ["sale-item", 99, "sale", 1],
  ];
  for (const [name, price, category, active] of rows) {
    database.prepare("INSERT INTO items (name, price, category, active) VALUES (?, ?, ?, ?)").run(
      name,
      price,
      category,
      active,
    );
  }
  return database;
}

test("grouped where closure produces parenthesized OR within an AND", async () => {
  seed();
  // active AND (price < 10 OR category = 'sale')
  const names = await db("items")
    .where("active", 1)
    .where((q) => q.where("price", "<", 10).orWhere("category", "sale"))
    .orderBy("id")
    .pluck("name");
  assert.deepEqual(names, ["a-cheap", "sale-item"]);
});

test("toSql / getBindings render without executing", () => {
  seed();
  const q = db("items").where("active", 1).where("price", ">", 10).orderBy("id");
  assert.equal(q.toSql(), "SELECT * FROM items WHERE active = ? AND price > ? ORDER BY id ASC");
  assert.deepEqual(q.getBindings(), [1, 10]);
});

test("orWhere family and whereNot", async () => {
  seed();
  const cats = await db("items").where("category", "a").orWhereIn("category", ["b"]).orderBy("id").pluck("category");
  assert.deepEqual(cats, ["a", "a", "b"]);

  const notA = await db("items").whereNot("category", "a").orderBy("id").pluck("category");
  assert.deepEqual(notA, ["b", "sale"]);

  const between = await db("items").whereNotBetween("price", [10, 100]).orderBy("id").pluck("name");
  assert.deepEqual(between, ["a-cheap", "b-cheap"]); // 5 and 8 are outside 10..100
});

test("selectRaw + groupBy + havingRaw", async () => {
  seed();
  const rows = await db("items")
    .select("category")
    .selectRaw("COUNT(*) AS n")
    .groupBy("category")
    .havingRaw("COUNT(*) > ?", [1])
    .get();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.category, "a");
  assert.equal(Number(rows[0]!.n), 2);
});

test("ordering: orderByDesc, reorder, take/skip/forPage", async () => {
  seed();
  assert.equal(await db("items").orderByDesc("price").take(1).value("name"), "sale-item");

  // reorder wipes the ASC order and applies DESC by price.
  const top = await db("items").orderBy("id").reorder("price", "desc").take(1).value("name");
  assert.equal(top, "sale-item");

  const page2 = await db("items").orderBy("id").forPage(2, 2).pluck("id");
  assert.deepEqual(page2, [3, 4]);
});

test("terminals: find, firstOrFail, sole, doesntExist, implode", async () => {
  seed();
  assert.equal((await db("items").find(1))!.name, "a-cheap");
  assert.equal(await db("items").where("id", 999).doesntExist(), true);

  await assert.rejects(() => db("items").where("id", 999).firstOrFail(), (e) => e instanceof NotFoundException);

  assert.equal((await db("items").where("id", 2).sole()).name, "a-dear");
  await assert.rejects(() => db("items").sole(), /Multiple rows/); // 4 rows

  assert.equal(await db("items").where("category", "a").orderBy("id").implode("name", ", "), "a-cheap, a-dear");
});

test("conditional: unless applies when falsy", async () => {
  seed();
  const active = await db("items").unless(false, (q) => q.where("active", 1)).count();
  assert.equal(active, 3);
  const all = await db("items").unless(true, (q) => q.where("active", 1)).count();
  assert.equal(all, 4);
});

test("writes: updateOrInsert, incrementEach, truncate", async () => {
  const raw = seed();

  await db("items").updateOrInsert({ name: "a-cheap" }, { price: 6 });
  assert.equal(await db("items").where("name", "a-cheap").value("price"), 6); // updated
  await db("items").updateOrInsert({ name: "new" }, { price: 1, category: "z", active: 1 });
  assert.equal(await db("items").where("name", "new").value("price"), 1); // inserted

  await db("items").where("category", "a").incrementEach({ price: 10, active: 0 });
  assert.equal(await db("items").where("name", "a-dear").value("price"), 60);

  await db("items").truncate();
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM items").get()!.c, 0);
});

test("simplePaginate reports hasMore without a count query", async () => {
  seed();
  const page1 = await db("items").orderBy("id").simplePaginate(1, 2);
  assert.equal(page1.data.length, 2);
  assert.equal(page1.hasMore, true);
  const page2 = await db("items").orderBy("id").simplePaginate(2, 2);
  assert.equal(page2.hasMore, false);
});

test("inRandomOrder + lockForUpdate run (locks are no-ops on sqlite)", async () => {
  seed();
  assert.equal((await db("items").inRandomOrder().get()).length, 4);
  assert.equal((await db("items").where("id", 1).lockForUpdate().first())!.name, "a-cheap");
});
