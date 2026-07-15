import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import {
  rateLimiter,
  redisRateLimitStore,
  cacheRateLimitStore,
  type RateLimiterOptions,
} from "../src/core/rate-limit.js";
import { Cache } from "../src/core/cache.js";
import { Redis, MemoryRedis } from "../src/core/redis.js";

async function build(opts: RateLimiterOptions, configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  kernel.use(rateLimiter(opts));
  return kernel.build();
}

test("allows up to max, then 429 with headers", async () => {
  const hono = await build({ max: 2, window: 60 }, (r) => r.get("/x", json({ ok: true })));
  const headers = { "x-forwarded-for": "9.9.9.9" };

  const r1 = await hono.request("/x", { headers });
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("x-ratelimit-limit"), "2");
  assert.equal(r1.headers.get("x-ratelimit-remaining"), "1");

  assert.equal((await hono.request("/x", { headers })).headers.get("x-ratelimit-remaining"), "0");

  const r3 = await hono.request("/x", { headers });
  assert.equal(r3.status, 429);
  assert.ok(r3.headers.get("retry-after"));
  assert.deepEqual(await r3.json(), { error: "Too Many Requests", status: 429 });
});

test("buckets by key — different IPs are independent", async () => {
  const hono = await build({ max: 1, window: 60 }, (r) => r.get("/x", json({ ok: true })));
  assert.equal((await hono.request("/x", { headers: { "x-forwarded-for": "1.1.1.1" } })).status, 200);
  assert.equal((await hono.request("/x", { headers: { "x-forwarded-for": "1.1.1.1" } })).status, 429);
  assert.equal((await hono.request("/x", { headers: { "x-forwarded-for": "2.2.2.2" } })).status, 200);
});

test("custom key function", async () => {
  const hono = await build(
    { max: 1, key: (c) => c.req.header("x-user") ?? "anon" },
    (r) => r.get("/x", json({ ok: true })),
  );
  assert.equal((await hono.request("/x", { headers: { "x-user": "a" } })).status, 200);
  assert.equal((await hono.request("/x", { headers: { "x-user": "a" } })).status, 429);
  assert.equal((await hono.request("/x", { headers: { "x-user": "b" } })).status, 200);
});

test("redis store: the tally is shared — two middlewares, one limit", async () => {
  const client = new Redis(new MemoryRedis());
  const store = redisRateLimitStore(client);
  const headers = { "x-forwarded-for": "9.9.9.9" };

  // Two separately-built apps (think: two nodes) sharing one Redis.
  const a = await build({ max: 2, window: 60, store }, (r) => r.get("/x", json({ ok: true })));
  const b = await build({ max: 2, window: 60, store }, (r) => r.get("/x", json({ ok: true })));

  assert.equal((await a.request("/x", { headers })).status, 200);
  assert.equal((await b.request("/x", { headers })).status, 200);
  assert.equal((await a.request("/x", { headers })).status, 429);
  assert.equal((await b.request("/x", { headers })).status, 429);
});

test("cache store: counts through any Cache and rolls the window over", async () => {
  const shared = new Cache();
  const store = cacheRateLimitStore(shared);
  const headers = { "x-forwarded-for": "8.8.8.8" };

  const hono = await build({ max: 1, window: 60, store }, (r) => r.get("/x", json({ ok: true })));
  assert.equal((await hono.request("/x", { headers })).status, 200);
  assert.equal((await hono.request("/x", { headers })).status, 429);

  // Rotate the window by expiring the bucket, and the key breathes again.
  await shared.forget("ratelimit:8.8.8.8");
  assert.equal((await hono.request("/x", { headers })).status, 200);
});
