import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { session, sessionMiddleware } from "../src/core/session.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  kernel.use(sessionMiddleware());
  return kernel.build();
}

test("session round-trips non-Latin1 values (emoji) without crashing the response", async () => {
  const hono = await build((r) => {
    r.get("/set", () => {
      session().put("greeting", "こんにちは 👋 café");
      return json({ ok: true });
    });
    r.get("/get", () => json({ greeting: session().get("greeting") }));
  });

  const set = await hono.request("/set");
  assert.equal(set.status, 200); // previously threw (btoa on non-Latin1) → 500
  const cookie = set.headers.get("set-cookie")!.split(";")[0]!;
  const got = await (await hono.request("/get", { headers: { cookie } })).json();
  assert.deepEqual(got, { greeting: "こんにちは 👋 café" });
});

test("session persists across requests via its cookie", async () => {
  const hono = await build((r) => {
    r.get("/set", () => {
      session().put("count", 5);
      return json({ ok: true });
    });
    r.get("/get", () => json({ count: session().get("count", 0) }));
  });

  const set = await hono.request("/set");
  const cookie = set.headers.get("set-cookie")!.split(";")[0]!;
  assert.ok(cookie.startsWith("keel_session="));

  assert.deepEqual(await (await hono.request("/get")).json(), { count: 0 });
  const got = await hono.request("/get", { headers: { cookie } });
  assert.deepEqual(await got.json(), { count: 5 });
});

test("session: has/forget/pull/increment", async () => {
  const hono = await build((r) => {
    r.get("/x", () => {
      const s = session();
      s.put("a", 1).increment("a", 2); // 3
      const has = s.has("a");
      const pulled = s.pull("a"); // 3, then removed
      return json({ has, pulled, after: s.has("a") });
    });
  });
  assert.deepEqual(await (await hono.request("/x")).json(), {
    has: true,
    pulled: 3,
    after: false,
  });
});

test("session flash survives exactly one request", async () => {
  const hono = await build((r) => {
    r.get("/flash", () => {
      session().flash("msg", "saved");
      return json({ ok: true });
    });
    r.get("/read", () => json({ msg: session().flashed("msg", null) }));
  });

  const f = await hono.request("/flash");
  const cookie = f.headers.get("set-cookie")!.split(";")[0];

  const r1 = await hono.request("/read", { headers: { cookie } });
  const c1 = r1.headers.get("set-cookie")!.split(";")[0];
  assert.deepEqual(await r1.json(), { msg: "saved" });

  const r2 = await hono.request("/read", { headers: { cookie: c1 } });
  assert.deepEqual(await r2.json(), { msg: null });
});

test("session() throws without the middleware", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/x", () => json({ v: session().get("a") }));
  const hono = new HttpKernel(app).build(); // no sessionMiddleware
  assert.equal((await hono.request("/x")).status, 500);
});
