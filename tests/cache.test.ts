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

test("cache: missing/add/forgetMany", async () => {
  const c = new Cache();

  assert.equal(await c.missing("a"), true);
  assert.equal(await c.add("a", 1), true); // written (was absent)
  assert.equal(await c.missing("a"), false);
  assert.equal(await c.add("a", 2), false); // not overwritten
  assert.equal(await c.get("a"), 1);

  await c.put("b", 2);
  await c.put("c", 3);
  await c.forgetMany(["a", "b", "c", "nope"]);
  assert.equal(await c.has("a"), false);
  assert.equal(await c.has("b"), false);
  assert.equal(await c.has("c"), false);
});

test("cache: remember dedupes concurrent factory runs (stampede protection)", async () => {
  const c = new Cache();
  let calls = 0;
  const factory = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return "v";
  };

  // Fire ten concurrent misses for the same cold key.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => c.remember("k", 60, factory)),
  );

  assert.deepEqual(results, Array(10).fill("v"));
  assert.equal(calls, 1); // factory ran exactly once
});

test("cache: grace serves a stale value when the refresh factory throws", async () => {
  const c = new Cache();
  let attempt = 0;
  const factory = () => {
    attempt++;
    if (attempt === 1) return "fresh";
    throw new Error("upstream down");
  };

  // ttl 0.02s (20ms), grace 60s — the value is retained well past its TTL.
  assert.equal(await c.remember("g", 0.02, factory, { grace: 60 }), "fresh");

  await new Promise((r) => setTimeout(r, 30)); // let the TTL lapse

  // Now stale; factory throws, so the graced (stale) value is served.
  assert.equal(await c.remember("g", 0.02, factory, { grace: 60 }), "fresh");
  assert.equal(attempt, 2); // the refresh was attempted
});

test("cache: without grace, an expired key recomputes (no stale served)", async () => {
  const c = new Cache();
  let n = 0;
  const factory = () => `v${++n}`;

  assert.equal(await c.remember("k", 0.02, factory), "v1");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await c.remember("k", 0.02, factory), "v2"); // recomputed
});

test("cache: a failing factory without grace rejects", async () => {
  const c = new Cache();
  await assert.rejects(
    c.remember("boom", 60, () => {
      throw new Error("nope");
    }),
    /nope/,
  );
  // The failure isn't cached — a later good factory succeeds.
  assert.equal(await c.remember("boom", 60, () => "ok"), "ok");
});

test("cache: deleteByTag invalidates every entry carrying the tag", async () => {
  const c = new Cache();

  await c.put("post:1", "a", undefined, { tags: ["posts"] });
  await c.put("post:2", "b", undefined, { tags: ["posts", "featured"] });
  await c.put("user:1", "u"); // untagged

  assert.equal(await c.get("post:1"), "a");
  assert.equal(await c.get("post:2"), "b");

  await c.deleteByTag(["posts"]);

  assert.equal(await c.has("post:1"), false); // invalidated
  assert.equal(await c.has("post:2"), false); // shared the "posts" tag
  assert.equal(await c.get("user:1"), "u"); // untouched

  // A fresh write under the same tag is valid again (records the new version).
  await c.put("post:1", "a2", undefined, { tags: ["posts"] });
  assert.equal(await c.get("post:1"), "a2");
});

test("cache: deleteByTag only hits the named tag", async () => {
  const c = new Cache();
  await c.put("x", 1, undefined, { tags: ["red"] });
  await c.put("y", 2, undefined, { tags: ["blue"] });

  await c.deleteByTag(["red"]);
  assert.equal(await c.has("x"), false);
  assert.equal(await c.get("y"), 2);
});

test("cache: remember accepts tags and honors invalidation", async () => {
  const c = new Cache();
  let calls = 0;
  const factory = () => `v${++calls}`;

  assert.equal(await c.remember("k", 60, factory, { tags: ["t"] }), "v1");
  assert.equal(await c.remember("k", 60, factory, { tags: ["t"] }), "v1"); // hit
  assert.equal(calls, 1);

  await c.deleteByTag(["t"]);
  assert.equal(await c.remember("k", 60, factory, { tags: ["t"] }), "v2"); // recomputed
  assert.equal(calls, 2);
});

test("cache: namespace scopes keys and flush clears only that namespace", async () => {
  const root = new Cache();
  const users = root.namespace("users");
  const posts = root.namespace("posts");

  await users.put("1", "alice");
  await posts.put("1", "hello");
  await root.put("1", "root");

  // Same logical key, isolated per namespace.
  assert.equal(await users.get("1"), "alice");
  assert.equal(await posts.get("1"), "hello");
  assert.equal(await root.get("1"), "root");

  await users.flush(); // scoped

  assert.equal(await users.has("1"), false); // cleared
  assert.equal(await posts.get("1"), "hello"); // untouched
  assert.equal(await root.get("1"), "root"); // untouched
});

test("cache: nested namespaces and namespace grace/remember", async () => {
  const root = new Cache();
  const team = root.namespace("org").namespace("team");

  let calls = 0;
  const v = await team.remember("count", 60, () => ++calls);
  assert.equal(v, 1);
  assert.equal(await team.remember("count", 60, () => ++calls), 1); // hit
  assert.equal(calls, 1);

  await team.flush();
  assert.equal(await team.has("count"), false);
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
