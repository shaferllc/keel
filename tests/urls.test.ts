import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";

test("url() supports params and query string", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);
  router.get("/u/:id", json({ ok: true })).name("u");

  assert.equal(router.url("u", { id: 5 }), "/u/5");
  assert.equal(
    router.url("u", { id: 5 }, { qs: { page: 2, sort: "name" } }),
    "/u/5?page=2&sort=name",
  );
});

test("signed URLs verify, and reject tampering / expiry / missing", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "test-secret" } } });
  const router = app.make(Router);
  router.get("/dl/:id", async () => json({ valid: await router.hasValidSignature() })).name("dl");
  const hono = new HttpKernel(app).build();

  const signed = await router.signedUrl("dl", { id: 7 });
  assert.deepEqual(await (await hono.request(signed)).json(), { valid: true });

  const tampered = signed.replace("/dl/7", "/dl/8");
  assert.deepEqual(await (await hono.request(tampered)).json(), { valid: false });

  assert.deepEqual(await (await hono.request("/dl/7")).json(), { valid: false });

  const expired = await router.signedUrl("dl", { id: 7 }, { expiresIn: -10 });
  assert.deepEqual(await (await hono.request(expired)).json(), { valid: false });
});
