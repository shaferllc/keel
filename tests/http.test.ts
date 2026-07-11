import { test } from "node:test";
import assert from "node:assert/strict";
import type { MiddlewareHandler } from "hono";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, param, query, header, body, request, response } from "../src/core/request.js";
import { NotFoundException, HttpException } from "../src/core/exceptions.js";
import type { Context } from "hono";
import { validate } from "../src/core/validation.js";

async function build(
  configure: (r: Router) => void,
  opts: { debug?: boolean; middleware?: MiddlewareHandler[] } = {},
) {
  const app = new Application();
  await app.boot([], {
    discoverConfig: false,
    config: { app: { name: "T", debug: opts.debug ?? false } },
  });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  for (const mw of opts.middleware ?? []) kernel.use(mw);
  return kernel.build();
}

test("static + closure routes respond", async () => {
  const hono = await build((r) => {
    r.get("/ping", json({ pong: true }));
    r.get("/hi", () => "hello");
  });
  const ping = await hono.request("/ping");
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { pong: true });

  const hi = await hono.request("/hi");
  assert.match(hi.headers.get("content-type") ?? "", /text\/html/);
});

test("request helpers read params, query, headers, body", async () => {
  const hono = await build((r) => {
    r.get("/u/:id", () => json({ id: param("id"), q: query("x"), h: header("x-test") }));
    r.post("/echo", async () => json(await body()));
  });

  const res = await hono.request("/u/5?x=1", { headers: { "x-test": "H" } });
  assert.deepEqual(await res.json(), { id: "5", q: "1", h: "H" });

  const echo = await hono.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.deepEqual(await echo.json(), { a: 1 });
});

test("response accessor sets status and headers", async () => {
  const hono = await build((r) => {
    r.get("/c", () => response.status(201).header("x-total", "9").json({ ok: true }));
  });
  const res = await hono.request("/c");
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-total"), "9");
});

test("request accessor exposes method/path/status", async () => {
  let seen = "";
  const spy: MiddlewareHandler = async (_c, next) => {
    await next();
    seen = `${request.method} ${request.path} ${request.status}`;
  };
  const hono = await build((r) => r.get("/x", json({ ok: true })), { middleware: [spy] });
  await hono.request("/x");
  assert.equal(seen, "GET /x 200");
});

test("validation: 201 on valid, 422 with field errors on invalid", async () => {
  const schema = {
    safeParse(data: unknown) {
      const d = data as { email?: unknown };
      return typeof d?.email === "string" && d.email.includes("@")
        ? { success: true as const, data: { email: d.email } }
        : {
            success: false as const,
            error: { issues: [{ path: ["email"], message: "invalid" }] },
          };
    },
  };
  const hono = await build((r) => {
    r.post("/users", async () => json(await validate(schema), 201));
  });

  const ok = await hono.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "a@b.com" }),
  });
  assert.equal(ok.status, 201);

  const bad = await hono.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nope" }),
  });
  assert.equal(bad.status, 422);
  assert.deepEqual(await bad.json(), {
    error: "The given data was invalid.",
    status: 422,
    code: "E_VALIDATION",
    errors: { email: ["invalid"] },
  });
});

test("errors: 404 for unmatched + HttpException, JSON vs HTML by Accept", async () => {
  const hono = await build((r) => {
    r.get("/gone", () => {
      throw new NotFoundException("gone");
    });
  });

  const unmatched = await hono.request("/nope", { headers: { accept: "application/json" } });
  assert.equal(unmatched.status, 404);
  assert.equal((await unmatched.json() as { status: number }).status, 404);

  const gone = await hono.request("/gone", { headers: { accept: "application/json" } });
  assert.deepEqual(await gone.json(), { error: "gone", status: 404, code: "E_NOT_FOUND" });

  const htmlErr = await hono.request("/nope", { headers: { accept: "text/html" } });
  assert.equal(htmlErr.status, 404);
  assert.match(await htmlErr.text(), /<!DOCTYPE html>/);
});

test("errors: 500 shows stack in debug, hides internals in prod", async () => {
  const boom = (r: Router) =>
    r.get("/boom", () => {
      throw new Error("secret detail");
    });

  const dev = await build(boom, { debug: true });
  const devRes = await dev.request("/boom", { headers: { accept: "application/json" } });
  assert.equal(devRes.status, 500);
  const devBody = (await devRes.json()) as { error: string; stack?: unknown };
  assert.equal(devBody.error, "secret detail");
  assert.ok(Array.isArray(devBody.stack));

  const prod = await build(boom, { debug: false });
  const prodRes = await prod.request("/boom", { headers: { accept: "application/json" } });
  const prodBody = (await prodRes.json()) as { error: string; stack?: unknown };
  assert.equal(prodBody.error, "Internal Server Error");
  assert.equal(prodBody.stack, undefined);
});

test("custom onError handler takes precedence", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { debug: false } } });
  app.make(Router).get("/x", () => {
    throw new Error("x");
  });
  const kernel = new HttpKernel(app);
  kernel.onError(() => new Response("handled", { status: 503 }));
  const hono = kernel.build();
  const res = await hono.request("/x");
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "handled");
});

test("routing: groups, param constraints, redirect, resource, url", async () => {
  const hono = await build((r) => {
    r.group(() => {
      r.get("/status", json({ up: true })).name("status");
    })
      .prefix("/api")
      .as("api");
    r.get("/n/:id", () => json({ id: param("id") })).where("id", /\d+/);
    r.on("/old").redirect("/new");
  });

  assert.deepEqual(await (await hono.request("/api/status")).json(), { up: true });
  assert.equal((await hono.request("/n/42")).status, 200);
  assert.equal((await hono.request("/n/abc")).status, 404);

  const red = await hono.request("/old");
  assert.equal(red.status, 302);
  assert.equal(red.headers.get("location"), "/new");
});

test("single-action and lazy-loaded controllers", async () => {
  class Invokable {
    handle() {
      return json({ via: "handle" });
    }
  }
  class Lazy {
    show() {
      return json({ via: "lazy" });
    }
  }
  const hono = await build((r) => {
    r.get("/single", [Invokable]); // no method → handle
    r.get("/lazy", [() => Promise.resolve({ default: Lazy }), "show"]);
  });
  assert.deepEqual(await (await hono.request("/single")).json(), { via: "handle" });
  assert.deepEqual(await (await hono.request("/lazy")).json(), { via: "lazy" });
});

test("exceptions: code, report(), and self-handling handle()", async () => {
  const reported: string[] = [];
  class PaymentRequired extends HttpException {
    code = "E_PAYMENT";
    constructor() {
      super(402, "Payment required");
    }
    report() {
      reported.push("reported");
    }
  }
  class Teapot extends HttpException {
    constructor() {
      super(418, "teapot");
    }
    handle(c: Context) {
      return c.json({ custom: true }, 418);
    }
  }
  const hono = await build((r) => {
    r.get("/pay", () => {
      throw new PaymentRequired();
    });
    r.get("/teapot", () => {
      throw new Teapot();
    });
  });

  const pay = await hono.request("/pay", { headers: { accept: "application/json" } });
  assert.equal(pay.status, 402);
  assert.deepEqual(await pay.json(), {
    error: "Payment required",
    status: 402,
    code: "E_PAYMENT",
  });
  assert.deepEqual(reported, ["reported"]);

  const teapot = await hono.request("/teapot");
  assert.equal(teapot.status, 418);
  assert.deepEqual(await teapot.json(), { custom: true });
});

test("named middleware registry: reference by name", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);
  router.named({
    auth: async (c, next) => {
      if (c.req.header("x-key") !== "ok") return c.json({ error: "denied" }, 401);
      await next();
    },
  });
  router.get("/protected", json({ ok: true })).use("auth");
  router
    .group(() => {
      router.get("/admin", json({ admin: true }));
    })
    .use("auth");
  const hono = new HttpKernel(app).build();

  assert.equal((await hono.request("/protected")).status, 401);
  assert.equal((await hono.request("/protected", { headers: { "x-key": "ok" } })).status, 200);
  assert.equal((await hono.request("/admin")).status, 401);
});

test("unknown named middleware throws at build", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/x", json({ ok: true })).use("nope");
  assert.throws(() => new HttpKernel(app).build(), /No named middleware/);
});

test("middleware runs in order and can short-circuit", async () => {
  const guard: MiddlewareHandler = async (c, next) => {
    if (c.req.header("x-key") !== "ok") return c.json({ error: "denied" }, 401);
    await next();
  };
  const hono = await build((r) => r.get("/p", json({ ok: true })), { middleware: [guard] });

  assert.equal((await hono.request("/p")).status, 401);
  assert.equal((await hono.request("/p", { headers: { "x-key": "ok" } })).status, 200);
});
