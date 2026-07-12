import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";

test("onReady hooks run after boot, in registration order", async () => {
  const app = new Application();
  const order: string[] = [];
  app.onReady(() => {
    order.push("a");
  });
  app.onReady(async () => {
    order.push("b");
  });
  assert.deepEqual(order, []); // not booted yet
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  assert.deepEqual(order, ["a", "b"]);
});

test("onReady runs immediately if already booted", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  let ran = false;
  app.onReady(() => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("onReady receives the application", async () => {
  const app = new Application();
  let received: unknown;
  app.onReady((a) => {
    received = a;
  });
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  assert.equal(received, app);
});

test("shutdown hooks run newest-first (LIFO) on terminate", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const order: string[] = [];
  app.onShutdown(() => {
    order.push("db");
  });
  app.onShutdown(async () => {
    order.push("redis");
  });
  await app.terminate();
  assert.deepEqual(order, ["redis", "db"]); // reverse of registration
  assert.equal(app.isTerminated, true);
});

test("terminate is idempotent", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  let calls = 0;
  app.onShutdown(() => {
    calls++;
  });
  await app.terminate();
  await app.terminate();
  assert.equal(calls, 1);
});

test("a throwing shutdown hook doesn't stop the others; first error re-thrown", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const ran: string[] = [];
  app.onShutdown(() => {
    ran.push("a");
  });
  app.onShutdown(() => {
    throw new Error("boom");
  });
  app.onShutdown(() => {
    ran.push("c");
  });
  await assert.rejects(() => app.terminate(), /boom/);
  assert.deepEqual(ran, ["c", "a"]); // "c" (newest) and "a" both ran despite the throw between them
});

test("router.onRoute fires on add and replays existing routes", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);
  router.get("/a", () => new Response("a"));

  const seen: string[] = [];
  router.onRoute((def) => seen.push(def.path)); // replays /a
  router.get("/b", () => new Response("b")); // fires live
  assert.deepEqual(seen, ["/a", "/b"]);
});

test("the def passed to onRoute is live (reflects later fluent config)", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);
  let captured: { name?: string } | undefined;
  router.onRoute((def) => {
    captured = def;
  });
  router.get("/users/:id", () => new Response("ok")).name("users.show");
  assert.equal(captured!.name, "users.show"); // name set after add(), visible on the live def
});

test("global onReady / onShutdown / terminate delegate to the active app", async () => {
  const { onReady, onShutdown, terminate } = await import("../src/core/helpers.js");
  const app = new Application(); // constructor sets it as the active app
  const order: string[] = [];
  onReady(() => void order.push("ready"));
  onShutdown(() => void order.push("bye"));
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  await terminate();
  assert.deepEqual(order, ["ready", "bye"]);
});
