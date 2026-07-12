import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { Model } from "../src/core/model.js";
import { setConnection, clearConnections, connection } from "../src/core/database.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";
import { testClient, type TestClient } from "../src/core/testing.js";
import {
  bindModel,
  bindRoute,
  boundModel,
  boundValue,
  clearBindings,
  hasBinding,
  paramNames,
} from "../src/core/binding.js";

class Post extends Model {
  static override table = "posts";
  static override fillable = ["title", "slug", "authorId"];
  declare id: number;
  declare title: string;
  declare slug: string;
  declare authorId: number;
}

class Author extends Model {
  static override table = "authors";
  static override fillable = ["name"];
  declare id: number;
  declare name: string;
}

/** A real database, so the lookups are real lookups. */
async function app(): Promise<Application> {
  clearConnections();
  clearBindings();

  const client = createClient({ url: ":memory:" });
  setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");

  await connection().write("CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)", []);
  await connection().write(
    "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, slug TEXT, authorId INTEGER)",
    [],
  );
  await connection().write("INSERT INTO authors (id, name) VALUES (1, 'Ada'), (2, 'Grace')", []);
  await connection().write(
    "INSERT INTO posts (id, title, slug, authorId) VALUES (1, 'Hello', 'hello', 1), (2, 'Secret', 'secret', 2)",
    [],
  );

  const application = new Application();
  await application.boot([], { discoverConfig: false, config: { app: {} } });
  return application;
}

function serve(application: Application): TestClient {
  return testClient(new HttpKernel(application));
}

/* --------------------------------- parsing -------------------------------- */

test("paramNames finds the parameters in a pattern", () => {
  assert.deepEqual(paramNames("/users/:user"), ["user"]);
  assert.deepEqual(paramNames("/users/:user/posts/:post"), ["user", "post"]);
  assert.deepEqual(paramNames("/health"), []);
});

/* ------------------------------ model binding ----------------------------- */

test("a :param arrives as a model, already fetched", async () => {
  const application = await app();
  bindModel("post", Post);

  application.make(Router).get("/posts/:post", (c) => {
    const post = boundModel(Post);
    // Not a string, and not null — the handler never had to check.
    assert.ok(post instanceof Post);
    return c.json({ id: post.id, title: post.title });
  });

  const res = await serve(application).get("/posts/1");
  res.assertOk().assertJson({ id: 1, title: "Hello" });
});

test("a row that doesn't exist is a 404 — before the handler runs", async () => {
  const application = await app();
  bindModel("post", Post);

  let ran = false;
  application.make(Router).get("/posts/:post", (c) => {
    ran = true;
    return c.json({});
  });

  const res = await serve(application).get("/posts/999");

  res.assertNotFound();
  // The whole point: "forgot the 404" stops being a bug you can write.
  assert.equal(ran, false, "the handler must not run for a missing row");
});

test("bind by another column when the URL isn't the id", async () => {
  const application = await app();
  bindModel("post", Post, { key: "slug" });

  application.make(Router).get("/posts/:post", (c) => c.json({ id: boundModel(Post).id }));

  const client = serve(application);
  (await client.get("/posts/hello")).assertOk().assertJson({ id: 1 });
  (await client.get("/posts/nope")).assertNotFound();
});

test("several models bind on one route", async () => {
  const application = await app();
  bindModel("author", Author);
  bindModel("post", Post);

  application.make(Router).get("/authors/:author/posts/:post", (c) =>
    c.json({ author: boundModel(Author).name, post: boundModel(Post).title }),
  );

  const res = await serve(application).get("/authors/1/posts/1");
  res.assertOk().assertJson({ author: "Ada", post: "Hello" });
});

/* ----------------------------- scope = security --------------------------- */

/**
 * `scope` is the security-critical option. A row outside it must be unreachable —
 * not merely filtered out of a list, but a 404 when you name its id directly.
 * Otherwise it's decoration, and someone finds that out by guessing.
 */
test("a row outside the scope is a 404, so it can't be reached by guessing an id", async () => {
  const application = await app();

  // Only Ada's posts (authorId 1) are reachable.
  bindModel("post", Post, { scope: (q) => q.where("authorId", 1) });

  let ran = false;
  application.make(Router).get("/posts/:post", (c) => {
    ran = true;
    return c.json({ id: boundModel(Post).id });
  });

  const client = serve(application);

  (await client.get("/posts/1")).assertOk().assertJson({ id: 1 }); // in scope
  assert.equal(ran, true, "the in-scope row reaches the handler");

  ran = false;
  const denied = await client.get("/posts/2"); // Grace's post — exists, out of scope
  denied.assertNotFound();
  assert.equal(ran, false, "the handler must not see a row outside the scope");
});

test("the scope can depend on the request", async () => {
  const application = await app();

  // Scope to whoever the caller claims to be.
  bindModel("post", Post, {
    scope: (q, c) => q.where("authorId", c.req.header("x-author") ?? "0"),
  });

  application.make(Router).get("/posts/:post", (c) => c.json({ id: boundModel(Post).id }));

  const client = serve(application);

  (await client.withHeader("x-author", "1").get("/posts/1")).assertOk();
  (await client.withHeader("x-author", "2").get("/posts/1")).assertNotFound();
  (await client.withHeader("x-author", "2").get("/posts/2")).assertOk();
});

/* -------------------------------- missing() ------------------------------- */

test("missing() can substitute a value instead of 404ing", async () => {
  const application = await app();

  bindModel("post", Post, {
    missing: () => new Post({ id: 0, title: "Not found", slug: "", authorId: 0 }),
  });

  application.make(Router).get("/posts/:post", (c) => c.json({ title: boundModel(Post).title }));

  const res = await serve(application).get("/posts/999");
  res.assertOk().assertJson({ title: "Not found" });
});

/* ------------------------------ bindRoute --------------------------------- */

test("bindRoute resolves anything at all", async () => {
  const application = await app();

  const tenants = new Map([["acme", { id: 7, name: "Acme" }]]);
  bindRoute("tenant", (slug) => tenants.get(slug));

  application.make(Router).get("/t/:tenant", (c) => {
    const tenant = boundValue<{ name: string }>("tenant");
    return c.json({ name: tenant!.name });
  });

  const client = serve(application);
  (await client.get("/t/acme")).assertOk().assertJson({ name: "Acme" });
  // Returning undefined is a 404 — no null reaches the handler.
  (await client.get("/t/nope")).assertNotFound();
});

/* -------------------------- middleware sees it ---------------------------- */

test("route middleware runs AFTER the binding, so a policy can read the model", async () => {
  const application = await app();
  bindModel("post", Post);

  // A policy that only lets Ada's posts through — it needs the model, not the id.
  const onlyAdas = async (c: { json: (b: unknown, s: number) => Response }, next: () => Promise<void>) => {
    if (boundModel(Post).authorId !== 1) return c.json({ error: "forbidden" }, 403);
    await next();
  };

  application
    .make(Router)
    .get("/posts/:post", (c) => c.json({ id: boundModel(Post).id }))
    .middleware(onlyAdas as never);

  const client = serve(application);
  (await client.get("/posts/1")).assertOk();
  (await client.get("/posts/2")).assertForbidden();
});

/* --------------------------------- errors --------------------------------- */

test("asking for a model nobody bound says how to bind it", async () => {
  await app(); // clears the bindings

  // The message is what a developer needs — the response body is deliberately
  // terse in production, so assert the error itself.
  assert.throws(() => boundModel(Post), /No route parameter is bound to Post/);
  assert.throws(() => boundModel(Post), /bindModel\("<param>", Post\)/);
});

test("an unbound route that asks for a model fails loudly, not silently", async () => {
  const application = await app();

  application.make(Router).get("/posts/:post", (c) => c.json({ id: boundModel(Post).id }));

  // No bindModel() call: a 500, not a mysterious undefined reaching the client.
  (await serve(application).get("/posts/1")).assertServerError();
});

test("two params bound to the same model must be disambiguated", async () => {
  const application = await app();
  bindModel("post", Post);
  bindModel("other", Post);

  application.make(Router).get("/posts/:post/vs/:other", (c) => {
    // Ambiguous on purpose — we can't guess which one you meant.
    assert.throws(() => boundModel(Post), /2 parameters are bound to Post/);
    return c.json({
      a: boundModel(Post, "post").id,
      b: boundModel(Post, "other").id,
    });
  });

  const res = await serve(application).get("/posts/1/vs/2");
  res.assertOk().assertJson({ a: 1, b: 2 });
});

/* -------------------------------- registry -------------------------------- */

test("hasBinding / clearBindings", async () => {
  await app();

  assert.equal(hasBinding("post"), false);
  bindModel("post", Post);
  assert.equal(hasBinding("post"), true);

  clearBindings();
  assert.equal(hasBinding("post"), false);
});

test("an unbound param is left alone — it's still just a string", async () => {
  const application = await app();
  // No binding registered for :id.

  application.make(Router).get("/raw/:id", (c) => c.json({ id: c.req.param("id") }));

  const res = await serve(application).get("/raw/abc");
  res.assertOk().assertJson({ id: "abc" });
});
