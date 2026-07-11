import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import {
  decorateRequest,
  hasRequestDecorator,
  decorated,
  setRequestValue,
  clearRequestDecorators,
} from "../src/core/decorators.js";

async function build(configure: (r: Router) => void) {
  clearRequestDecorators();
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("decorateRequest resolves a value per request", async () => {
  const hono = await build((r) => {
    decorateRequest("locale", (c) => c.req.header("accept-language") ?? "en");
    r.get("/", async () => json({ locale: await decorated<string>("locale") }));
  });

  assert.deepEqual(await (await hono.request("/")).json(), { locale: "en" });
  assert.deepEqual(
    await (await hono.request("/", { headers: { "accept-language": "fr" } })).json(),
    { locale: "fr" },
  );
});

test("a resolver runs once per request (memoized)", async () => {
  let calls = 0;
  const hono = await build((r) => {
    decorateRequest("expensive", async () => {
      calls++;
      return calls;
    });
    r.get("/", async () => {
      const a = await decorated<number>("expensive");
      const b = await decorated<number>("expensive"); // cached
      return json({ a, b });
    });
  });

  const res = await (await hono.request("/")).json();
  assert.deepEqual(res, { a: 1, b: 1 });
  // a second request recomputes (fresh memo)
  await hono.request("/");
  assert.equal(calls, 2);
});

test("async resolver (e.g. a DB lookup) works", async () => {
  const hono = await build((r) => {
    decorateRequest("user", async (c) => {
      const id = c.req.header("x-user");
      return id ? { id: Number(id), name: "Ada" } : null;
    });
    r.get("/", async () => json({ user: await decorated("user") }));
  });

  assert.deepEqual(await (await hono.request("/", { headers: { "x-user": "7" } })).json(), {
    user: { id: 7, name: "Ada" },
  });
  assert.deepEqual(await (await hono.request("/")).json(), { user: null });
});

test("setRequestValue overrides the resolver for the current request", async () => {
  const hono = await build((r) => {
    decorateRequest("tenant", () => "default");
    r.get("/", async () => {
      setRequestValue("tenant", "acme");
      return json({ tenant: await decorated<string>("tenant") });
    });
  });
  assert.deepEqual(await (await hono.request("/")).json(), { tenant: "acme" });
});

test("hasRequestDecorator + collision guard", async () => {
  clearRequestDecorators();
  assert.equal(hasRequestDecorator("x"), false);
  decorateRequest("x", () => 1);
  assert.equal(hasRequestDecorator("x"), true);
  assert.throws(() => decorateRequest("x", () => 2), /already registered/);
});

test("accessing an unknown decorator throws", async () => {
  const hono = await build((r) => {
    r.get("/", async () => json({ v: await decorated("missing") }));
  });
  const res = await hono.request("/");
  assert.equal(res.status, 500); // the thrown error surfaces through the kernel
});
