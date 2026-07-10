import { test } from "node:test";
import assert from "node:assert/strict";

import { Container } from "../src/core/container.js";
import { Router } from "../src/core/http/router.js";

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

  // controller tuple
  const ctrlFn = r.resolve([Ctrl, "hi"]);
  assert.equal(await (ctrlFn({} as never) as Response).text(), "hello");

  // missing method throws
  assert.throws(() => r.resolve([Ctrl, "nope"])({} as never), /has no method/);

  // plain function passthrough
  const fn = () => new Response("fn");
  assert.equal(r.resolve(fn), fn);
});
