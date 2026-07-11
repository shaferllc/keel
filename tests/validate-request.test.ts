import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { validateRequest, validated } from "../src/core/validation.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

function postJson(hono: Awaited<ReturnType<typeof build>>, path: string, body: unknown) {
  return hono.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NewUser = z.object({ email: z.string().email(), name: z.string().min(1) });

test("valid body passes; validated('body') returns the parsed value", async () => {
  const hono = await build((r) => {
    r.post("/users", () => {
      const user = validated<z.infer<typeof NewUser>>("body");
      return json({ created: user.email });
    }).middleware([validateRequest({ body: NewUser })]);
  });

  const res = await postJson(hono, "/users", { email: "a@b.com", name: "Ada" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { created: "a@b.com" });
});

test("invalid body is rejected before the handler (422) with keyed errors", async () => {
  let handlerRan = false;
  const hono = await build((r) => {
    r.post("/users", () => {
      handlerRan = true;
      return json({ ok: true });
    }).middleware([validateRequest({ body: NewUser })]);
  });

  const res = await postJson(hono, "/users", { email: "nope", name: "" });
  assert.equal(res.status, 422);
  assert.equal(handlerRan, false); // rejected before the handler
  const errbody = (await res.json()) as { errors: Record<string, string[]> };
  assert.ok(errbody.errors["body.email"]);
  assert.ok(errbody.errors["body.name"]);
});

test("query and params validate too, with coercion; errors aggregate across parts", async () => {
  const hono = await build((r) => {
    r.get("/posts/:id", () => {
      const q = validated<{ page: number }>("query");
      const p = validated<{ id: number }>("params");
      return json({ page: q.page, id: p.id });
    }).middleware([
      validateRequest({
        query: z.object({ page: z.coerce.number().min(1) }),
        params: z.object({ id: z.coerce.number() }),
      }),
    ]);
  });

  const ok = await hono.request("/posts/42?page=2");
  assert.deepEqual(await ok.json(), { page: 2, id: 42 }); // coerced to numbers

  const bad = await hono.request("/posts/notanumber?page=0");
  assert.equal(bad.status, 422);
  const errbody = (await bad.json()) as { errors: Record<string, string[]> };
  assert.ok(errbody.errors["query.page"]); // page < 1
  assert.ok(errbody.errors["params.id"]); // not a number
});

test("validated() throws when the part wasn't validated", async () => {
  const hono = await build((r) => {
    r.get("/x", () => json({ v: validated("body") }));
  });
  const res = await hono.request("/x");
  assert.equal(res.status, 500); // the thrown error surfaces through the kernel
});
