import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Redis,
  MemoryRedis,
  redis,
  setRedis,
  redisStore,
  type RedisConnection,
} from "../src/core/redis.js";
import { Cache } from "../src/core/cache.js";

test("basic get/set/del/exists", async () => {
  const r = new Redis(new MemoryRedis());
  assert.equal(await r.get("k"), null);
  await r.set("k", "v");
  assert.equal(await r.get("k"), "v");
  assert.equal(await r.has("k"), true);
  assert.equal(await r.del("k"), 1);
  assert.equal(await r.has("k"), false);
});

test("counters: incr / decr / incrBy", async () => {
  const r = new Redis(new MemoryRedis());
  assert.equal(await r.incr("n"), 1);
  assert.equal(await r.incr("n"), 2);
  assert.equal(await r.incrBy("n", 5), 7);
  assert.equal(await r.decr("n"), 6);
});

test("ttl and expiry", async () => {
  const r = new Redis(new MemoryRedis());
  await r.set("a", "1");
  assert.equal(await r.ttl("a"), -1); // no expiry
  assert.equal(await r.ttl("missing"), -2); // no key

  await r.set("b", "1", { ex: 100 });
  const ttl = await r.ttl("b");
  assert.ok(ttl > 0 && ttl <= 100);

  await r.expire("a", 50);
  assert.ok((await r.ttl("a")) > 0);
});

test("expired keys read as absent", async () => {
  const r = new Redis(new MemoryRedis());
  await r.set("gone", "1", { px: 1 });
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(await r.get("gone"), null);
  assert.equal(await r.has("gone"), false);
});

test("JSON helpers", async () => {
  const r = new Redis(new MemoryRedis());
  await r.setJson("u", { id: 1, name: "Ada" });
  assert.deepEqual(await r.getJson<{ id: number; name: string }>("u"), { id: 1, name: "Ada" });
  assert.equal(await r.getJson("nope"), null);
});

test("remember computes once, then serves from cache", async () => {
  const r = new Redis(new MemoryRedis());
  let calls = 0;
  const factory = () => {
    calls++;
    return { hits: calls };
  };
  assert.deepEqual(await r.remember("key", 60, factory), { hits: 1 });
  assert.deepEqual(await r.remember("key", 60, factory), { hits: 1 }); // cached
  assert.equal(calls, 1);
});

test("keys supports glob patterns", async () => {
  const r = new Redis(new MemoryRedis());
  await r.set("user:1", "a");
  await r.set("user:2", "b");
  await r.set("post:1", "c");
  assert.deepEqual((await r.keys("user:*")).sort(), ["user:1", "user:2"]);
  assert.equal((await r.keys("*")).length, 3);
});

test("global redis() / setRedis()", async () => {
  const conn = new MemoryRedis();
  const returned = setRedis(conn);
  assert.ok(returned instanceof Redis);
  await redis().set("g", "1");
  assert.equal(await redis().get("g"), "1");
});

test("redisStore adapts Redis into a CacheStore (Cache can be Redis-backed)", async () => {
  const cache = new Cache(redisStore(new Redis(new MemoryRedis())));
  await cache.put("x", { a: 1 }, 1000);
  assert.deepEqual(await cache.get("x"), { a: 1 });
  const remembered = await cache.remember("y", 1000, () => 42);
  assert.equal(remembered, 42);
  assert.equal(await cache.get("y"), 42);
  await cache.forget("x");
  assert.equal(await cache.get("x"), undefined); // cache miss sentinel

});

test("a custom RedisConnection receives commands", async () => {
  const seen: string[] = [];
  const conn: RedisConnection = {
    async get(k) {
      seen.push(`get ${k}`);
      return null;
    },
    async set(k) {
      seen.push(`set ${k}`);
    },
    async del() {
      return 0;
    },
    async exists() {
      return 0;
    },
    async incrBy(k, n) {
      seen.push(`incrBy ${k} ${n}`);
      return n;
    },
    async expire() {
      return true;
    },
    async ttl() {
      return -1;
    },
    async keys() {
      return [];
    },
    async flushAll() {},
  };
  const r = new Redis(conn);
  await r.get("a");
  await r.set("a", "1");
  await r.incrBy("a", 3);
  assert.deepEqual(seen, ["get a", "set a", "incrBy a 3"]);
});
