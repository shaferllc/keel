import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createClient } from "@libsql/client";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { Model } from "../src/core/model.js";
import { setConnection, clearConnections, connection } from "../src/core/database.js";
import { testClient, type TestClient } from "../src/core/testing.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";
import { apiResource, type ApiResourceOptions } from "../src/api/resource.js";
import { parseListParams } from "../src/api/query.js";
import type { Ctx } from "../src/core/http/router.js";

/* --------------------------- allow-listing (pure) ------------------------- */

function fakeCtx(query: Record<string, string>): Ctx {
  return { req: { query: () => query } } as unknown as Ctx;
}

test("parseListParams: only allow-listed columns filter and sort", () => {
  const params = parseListParams(
    fakeCtx({ status: "published", secret: "leak", sort: "title,-createdAt,secret", page: "2" }),
    { filter: ["status"], sort: ["title", "createdAt"], perPage: 25, maxPerPage: 100 },
  );
  // `secret` is not allow-listed, so it never becomes a filter…
  assert.deepEqual(params.filters, [{ column: "status", value: "published" }]);
  // …nor a sort; `title` asc and `createdAt` desc survive, `secret` is dropped.
  assert.deepEqual(params.sort, [
    { column: "title", direction: "asc" },
    { column: "createdAt", direction: "desc" },
  ]);
  assert.equal(params.page, 2);
});

test("parseListParams: perPage is clamped to maxPerPage and floored at 1", () => {
  assert.equal(
    parseListParams(fakeCtx({ perPage: "9999" }), { filter: [], sort: [], perPage: 25, maxPerPage: 100 }).perPage,
    100,
  );
  assert.equal(
    parseListParams(fakeCtx({ perPage: "0" }), { filter: [], sort: [], perPage: 25, maxPerPage: 100 }).perPage,
    1,
  );
  assert.equal(
    parseListParams(fakeCtx({}), { filter: [], sort: [], perPage: 25, maxPerPage: 100 }).perPage,
    25,
  );
});

/* ------------------------------ CRUD (real DB) ---------------------------- */

class Item extends Model {
  static table = "items";
  static fillable = ["name", "kind"];
  declare id: number;
  declare name: string;
  declare kind: string;
}

async function setup(options: ApiResourceOptions): Promise<TestClient> {
  clearConnections();
  const client = createClient({ url: ":memory:" });
  setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");
  await connection().write(
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kind TEXT)",
    [],
  );
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  apiResource(app.make(Router), Item, options);
  return testClient(app);
}

const open: ApiResourceOptions = {
  filter: ["kind"],
  sort: ["id", "name"],
  body: z.object({ name: z.string().min(1), kind: z.string() }),
  access: { read: true, write: true },
};

test("apiResource: full create/read/update/delete lifecycle", async () => {
  const client = await setup(open);

  const created = await client.post("/items", { name: "Alpha", kind: "x" });
  created.assertStatus(201);
  const id = created.json<{ data: { id: number; name: string } }>().data.id;
  assert.ok(id);

  await client.post("/items", { name: "Beta", kind: "y" });

  // list — paginated envelope with meta
  const list = await client.get("/items");
  list.assertOk();
  const body = list.json<{ data: unknown[]; meta: { total: number } }>();
  assert.equal(body.meta.total, 2);
  assert.equal(body.data.length, 2);

  // read one
  (await client.get(`/items/${id}`)).assertOk().assertJsonContains({ data: { name: "Alpha" } });

  // update
  (await client.patch(`/items/${id}`, { name: "Alpha2", kind: "x" }))
    .assertOk()
    .assertJsonContains({ data: { name: "Alpha2" } });

  // delete, then it's gone
  (await client.delete(`/items/${id}`)).assertStatus(204);
  (await client.get(`/items/${id}`)).assertStatus(404);

  clearConnections();
});

test("apiResource: filtering and sorting honor the allow-list", async () => {
  const client = await setup(open);
  await client.post("/items", { name: "Cee", kind: "x" });
  await client.post("/items", { name: "Aye", kind: "x" });
  await client.post("/items", { name: "Bee", kind: "y" });

  // allow-listed filter works
  const filtered = await client.get("/items?kind=x");
  assert.equal(filtered.json<{ meta: { total: number } }>().meta.total, 2);

  // a non-allow-listed filter is ignored (returns everything), not honored
  const ignored = await client.get("/items?name=Cee");
  assert.equal(ignored.json<{ meta: { total: number } }>().meta.total, 3);

  // allow-listed sort
  const sorted = await client.get("/items?sort=name");
  const names = sorted.json<{ data: { name: string }[] }>().data.map((d) => d.name);
  assert.deepEqual(names, ["Aye", "Bee", "Cee"]);

  clearConnections();
});

test("apiResource: validation rejects a bad body with 422", async () => {
  const client = await setup(open);
  (await client.post("/items", { name: "", kind: "x" })).assertStatus(422);
  clearConnections();
});

test("apiResource: access is deny-by-default", async () => {
  const client = await setup({ ...open, access: {} }); // no rules → everything denied
  (await client.get("/items")).assertStatus(403);
  (await client.post("/items", { name: "x", kind: "y" })).assertStatus(403);
  clearConnections();
});

test("apiResource: attaches OpenAPI metadata without importing the openapi package", () => {
  const app = new Application();
  const router = app.make(Router);
  apiResource(router, Item, { ...open, tags: ["things"] });
  const create = router.all().find((r) => r.name === "items.create")!;
  const meta = create.config.openapi as { summary: string; tags: string[]; request?: { body: unknown } };
  assert.equal(meta.summary, "Create Item"); // label defaults to the model class name
  assert.deepEqual(meta.tags, ["things"]);
  assert.ok(meta.request?.body, "the create body schema is carried for docs");
});

test("apiResource: read/write shorthands and only/except", async () => {
  const client = await setup({ ...open, access: { read: true }, only: ["list", "read"] });
  (await client.get("/items")).assertOk(); // read allowed
  (await client.post("/items", { name: "x", kind: "y" })).assertStatus(404); // create route not registered
  clearConnections();
});
