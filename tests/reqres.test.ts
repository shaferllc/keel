import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, request, response } from "../src/core/request.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("request: all/input/only/except merge query and body", async () => {
  const hono = await build((r) => {
    r.post("/x", async () =>
      json({
        all: await request.all(),
        input: await request.input("email", "def"),
        missing: await request.input("nope", "fb"),
        only: await request.only(["email"]),
        except: await request.except(["email"]),
      }),
    );
  });
  const res = await hono.request("/x?page=2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "a@b.com", age: 30 }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(data.all, { page: "2", email: "a@b.com", age: 30 });
  assert.equal(data.input, "a@b.com");
  assert.equal(data.missing, "fb");
  assert.deepEqual(data.only, { email: "a@b.com" });
  assert.deepEqual(data.except, { page: "2", age: 30 });
});

test("request: cookies and ip", async () => {
  const hono = await build((r) => {
    r.get("/y", () =>
      json({
        cookie: request.cookie("session"),
        cookies: request.cookie(),
        ip: request.ip(),
      }),
    );
  });
  const res = await hono.request("/y", {
    headers: { cookie: "session=abc; other=1", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
  const data = (await res.json()) as Record<string, unknown>;
  assert.equal(data.cookie, "abc");
  assert.deepEqual(data.cookies, { session: "abc", other: "1" });
  assert.equal(data.ip, "1.2.3.4");
});

test("response: cookie, clearCookie, send, abort", async () => {
  const hono = await build((r) => {
    r.get("/set", () => response.cookie("s", "v", { httpOnly: true }).json({ ok: true }));
    r.get("/clear", () => response.clearCookie("s").json({ ok: true }));
    r.get("/send-obj", () => response.send({ a: 1 }));
    r.get("/send-str", () => response.send("hi"));
    r.get("/abort", () => response.abort("nope", 403));
  });

  const set = await hono.request("/set");
  assert.match(set.headers.get("set-cookie") ?? "", /s=v/);
  assert.match(set.headers.get("set-cookie") ?? "", /HttpOnly/i);

  const clear = await hono.request("/clear");
  assert.match(clear.headers.get("set-cookie") ?? "", /s=/);

  assert.deepEqual(await (await hono.request("/send-obj")).json(), { a: 1 });
  assert.match(
    (await hono.request("/send-str")).headers.get("content-type") ?? "",
    /text\/plain/,
  );

  assert.equal((await hono.request("/abort", { headers: { accept: "application/json" } })).status, 403);
});
