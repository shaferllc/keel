import { test } from "node:test";
import assert from "node:assert/strict";

import { Cache, MemoryStore } from "../src/core/cache.js";
import { Application } from "../src/core/application.js";
import { cache } from "../src/core/helpers.js";

test("cache: put/get/has/forget/pull/flush", async () => {
  const c = new Cache();
  await c.put("a", 1);
  assert.equal(await c.get("a"), 1);
  assert.equal(await c.get("missing", "def"), "def");
  assert.equal(await c.has("a"), true);

  await c.forget("a");
  assert.equal(await c.has("a"), false);

  await c.put("b", 2);
  assert.equal(await c.pull("b"), 2);
  assert.equal(await c.has("b"), false);

  await c.put("c", 3);
  await c.flush();
  assert.equal(await c.has("c"), false);
});

test("cache: remember computes once, then serves cached", async () => {
  const c = new Cache();
  let calls = 0;
  const factory = () => {
    calls++;
    return "value";
  };
  assert.equal(await c.remember("k", 60, factory), "value");
  assert.equal(await c.remember("k", 60, factory), "value");
  assert.equal(calls, 1);

  let forever = 0;
  await c.rememberForever("f", () => (forever++, 1));
  await c.rememberForever("f", () => (forever++, 1));
  assert.equal(forever, 1);
});

test("cache: TTL expires entries", async () => {
  const store = new MemoryStore();
  store.set("x", 1, 5); // expires in 5ms
  assert.equal(store.get("x"), 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(store.get("x"), undefined);
});

test("cache() helper resolves the application's cache", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  await cache().put("z", 9);
  assert.equal(await cache().get("z"), 9);
});
