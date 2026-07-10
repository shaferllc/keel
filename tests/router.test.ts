import { test } from "node:test";
import assert from "node:assert/strict";

import { Container } from "../src/core/container.js";
import { Router, matchers } from "../src/core/http/router.js";

function router() {
  return new Router(new Container());
}

test("router: verbs register routes with the right methods", () => {
  const r = router();
  r.get("/a", () => new Response("a"));
  r.post("/b", () => new Response("b"));
  r.put("/c", () => new Response("c"));
  r.patch("/d", () => new Response("d"));
  r.delete("/e", () => new Response("e"));
  r.any("/f", () => new Response("f"));
  r.route(["GET", "POST"], "/g", () => new Response("g"));

  const all = r.all();
  assert.equal(all.length, 7);
  assert.deepEqual(all[0]!.methods, ["GET"]);
  assert.equal(all[5]!.methods.length, 7); // any()
  assert.deepEqual(all[6]!.methods, ["GET", "POST"]);
});

test("router: named routes and URL generation", () => {
  const r = router();
  r.get("/users/:id", () => new Response("x")).name("users.show");
  r.get("/posts/:id?", () => new Response("y")).as("posts.show");

  assert.equal(r.url("users.show", { id: 42 }), "/users/42");
  assert.equal(r.url("posts.show", {}), "/posts"); // optional param stripped
  assert.throws(() => r.url("nope"), /No route named/);
});

test("router: groups apply prefix, middleware, and name prefix", () => {
  const r = router();
  const mw = async (_c: never, next: () => Promise<void>) => next();
  r.group(() => {
    r.get("/status", () => new Response("s")).name("status");
  })
    .prefix("/api")
    .middleware(mw as never)
    .as("v1");

  const route = r.all().find((x) => x.path === "/api/status");
  assert.ok(route);
  assert.equal(route!.name, "v1.status");
  assert.equal(route!.middleware.length, 1);
});

test("router: resource generates RESTful routes; only/except/apiOnly trim", () => {
  class Ctrl {}
  const full = router();
  full.resource("posts", Ctrl);
  assert.equal(full.all().length, 7);

  const onlyR = router();
  onlyR.resource("posts", Ctrl).only(["index", "show"]);
  assert.equal(onlyR.all().length, 2);

  const apiR = router();
  apiR.resource("posts", Ctrl).apiOnly(); // drops create + edit
  assert.equal(apiR.all().length, 5);
  assert.ok(!apiR.all().some((x) => x.path.endsWith("/create")));
});

test("router: resource nesting, as, params, and use", () => {
  class Ctrl {}
  const nested = router();
  nested.resource("posts.comments", Ctrl);
  const show = nested.all().find((x) => x.name === "posts.comments.show");
  assert.equal(show!.path, "/posts/:post_id/comments/:id");

  const renamed = router();
  renamed.resource("posts", Ctrl).as("articles");
  assert.ok(renamed.all().some((x) => x.name === "articles.index"));

  const reparam = router();
  reparam.resource("posts", Ctrl).params({ posts: "post" });
  assert.ok(reparam.all().some((x) => x.path === "/posts/:post"));

  const guarded = router();
  const mw = async (_c: never, next: () => Promise<void>) => next();
  guarded.resource("posts", Ctrl).use(["store", "update"], mw);
  assert.equal(guarded.all().find((x) => x.name === "posts.store")!.middleware.length, 1);
  assert.equal(guarded.all().find((x) => x.name === "posts.index")!.middleware.length, 0);
});

test("router: on().redirect and on().render register GET routes", () => {
  const r = router();
  r.on("/old").redirect("/new");
  r.on("/about").render(() => "About");
  const paths = r.all().map((x) => x.path);
  assert.ok(paths.includes("/old"));
  assert.ok(paths.includes("/about"));
});

test("router: where sets a param constraint", () => {
  const r = router();
  r.get("/n/:id", () => new Response("n")).where("id", /\d+/);
  assert.equal(r.all()[0]!.wheres.id, "\\d+");
});

test("router: matchers, use alias, where forms, domain, global where, redirects", () => {
  assert.equal(matchers.number().source, "\\d+");
  assert.ok(matchers.uuid().source.includes("[0-9a-fA-F]"));
  assert.ok(matchers.slug().source.length > 0);
  assert.ok(matchers.alpha().source.includes("a-zA-Z"));

  const mw = async (_c: never, next: () => Promise<void>) => next();

  const r = router();
  r.get("/a/:id", () => new Response("a"))
    .use(mw)
    .where("id", { match: /\d+/ })
    .domain("api.example.com");
  const a = r.all()[0]!;
  assert.equal(a.middleware.length, 1);
  assert.equal(a.wheres.id, "\\d+");
  assert.equal(a.domain, "api.example.com");

  const r2 = router();
  r2.group(() => {
    r2.get("/b/:id", () => new Response("b"));
  })
    .use(mw)
    .where("id", "slug")
    .domain(":t.example.com");
  const b = r2.all()[0]!;
  assert.equal(b.middleware.length, 1);
  assert.equal(b.wheres.id, "slug");
  assert.equal(b.domain, ":t.example.com");

  const r3 = router();
  r3.where("id", matchers.number());
  r3.get("/c/:id", () => new Response("c")).where("x", "[0-9]+");
  assert.equal(r3.all()[0]!.wheres.id, "\\d+");
  assert.equal(r3.all()[0]!.wheres.x, "[0-9]+");

  const r4 = router();
  r4.get("/articles", () => new Response("x")).name("articles.index");
  r4.on("/posts").redirectToRoute("articles.index", {}, { qs: { page: 1 } });
  r4.on("/ext").redirectToPath("https://x.com");
  r4.on("/v").render(() => "V");
  const paths = r4.all().map((x) => x.path);
  assert.ok(["/posts", "/ext", "/v"].every((p) => paths.includes(p)));
});

test("router: resolve handles Response, controller tuples, and functions", async () => {
  const container = new Container();
  class Ctrl {
    hi() {
      return new Response("hello");
    }
  }
  container.instance(Ctrl, new Ctrl());
  const r = new Router(container);

  // static Response is cloned per call
  const staticFn = r.resolve(new Response("static"));
  const r1 = staticFn({} as never) as Response;
  assert.equal(await r1.text(), "static");

  // controller tuple (resolve is async — supports lazy loaders)
  const ctrlFn = r.resolve([Ctrl, "hi"]);
  assert.equal(await ((await ctrlFn({} as never)) as Response).text(), "hello");

  // missing method rejects
  await assert.rejects(
    () => r.resolve([Ctrl, "nope"])({} as never) as Promise<unknown>,
    /has no method/,
  );

  // plain function passthrough
  const fn = () => new Response("fn");
  assert.equal(r.resolve(fn), fn);
});
