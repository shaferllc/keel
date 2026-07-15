import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { instrument, runRequest } from "../src/core/instrumentation.js";
import { logger, emit } from "../src/core/helpers.js";
import { setConnection, clearConnections, db, type Connection } from "../src/core/database.js";

import { MemoryStore } from "../src/watch/store.js";
import { Recorder } from "../src/watch/recorder.js";
import { installWatchers } from "../src/watch/watchers.js";
import { WatchServiceProvider } from "../src/watch/provider.js";
import { Watch } from "../src/watch/gate.js";
import { passesGate } from "../src/watch/gate.js";
import type { WatchConfig } from "../src/watch/config.js";
import { Router } from "../src/core/http/router.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

function fullConfig(over: Partial<WatchConfig> = {}): WatchConfig {
  return {
    enabled: true,
    path: "watch",
    storage: "memory",
    table: "watch_entries",
    limit: 100,
    sampling: 1,
    slowQueryMs: 100,
    ignorePaths: [],
    retentionHours: 24,
    watchers: {
      request: true,
      query: true,
      exception: true,
      log: true,
      mail: true,
      job: true,
      notification: true,
      cache: true,
      event: true,
      schedule: true,
    },
    ...over,
  };
}

test("watchers: record request, query, exception, log — and link them by batch", async () => {
  new Application(); // active app so instrument()/emit() have somewhere to fire
  clearConnections();
  const conn: Connection = {
    async select() {
      return [];
    },
    async write() {
      return { rowsAffected: 0 };
    },
  };
  setConnection(conn, "sqlite");

  const store = new MemoryStore();
  const teardown = installWatchers(new Recorder(store, fullConfig()), fullConfig());

  await runRequest("batch-1", async () => {
    await db("users").where("id", 1).get(); // -> db.query
    logger().info("hello from the request"); // -> log
    instrument("exception", { error: new Error("boom"), status: 500, requestId: "batch-1" });
  });
  instrument("request.handled", {
    id: "batch-1",
    method: "GET",
    path: "/users/1",
    status: 200,
    durationMs: 12,
    headers: { authorization: "secret", accept: "text/html" },
  });
  await tick();

  const requests = await store.list({ type: "request" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.content.path, "/users/1");
  // Sensitive headers are redacted before storage.
  assert.equal((requests[0]!.content.headers as Record<string, string>).authorization, "[redacted]");

  assert.equal((await store.list({ type: "query" })).length, 1);
  assert.equal((await store.list({ type: "log" })).length, 1);
  assert.equal((await store.list({ type: "exception" })).length, 1);

  // Everything that happened in the request shares its batch id.
  const batch = await store.batch("batch-1");
  const types = batch.map((e) => e.type).sort();
  assert.deepEqual(types, ["exception", "log", "query", "request"]);

  teardown();
  clearConnections();
});

test("watchers: the store's own queries are never recorded (no feedback loop)", async () => {
  new Application();
  clearConnections();
  setConnection(
    {
      async select() {
        return [];
      },
      async write() {
        return { rowsAffected: 0 };
      },
    },
    "sqlite",
  );

  const store = new MemoryStore();
  const teardown = installWatchers(new Recorder(store, fullConfig()), fullConfig());

  // A query that touches the watch table must be ignored by the query watcher.
  await db("watch_entries").where("type", "request").get();
  await tick();
  assert.equal((await store.list({ type: "query" })).length, 0);

  teardown();
  clearConnections();
});

test("watchers: disabled types record nothing", async () => {
  new Application();
  const config = fullConfig({ watchers: { ...fullConfig().watchers, event: false } });
  const store = new MemoryStore();
  const teardown = installWatchers(new Recorder(store, config), config);

  await emit("user.registered", { id: 1 });
  await tick();
  assert.equal((await store.list({ type: "event" })).length, 0);

  teardown();
});

test("MemoryStore: round-trips, counts, prunes, clears", async () => {
  const store = new MemoryStore(3);
  const now = Date.now();
  await store.record([
    { uuid: "a", batchId: "b", type: "log", content: {}, tags: ["level:info"], createdAt: now - 1000 },
    { uuid: "c", batchId: "b", type: "query", content: {}, tags: ["slow"], createdAt: now },
  ]);
  assert.equal((await store.get("a"))?.type, "log");
  assert.deepEqual((await store.list({ tag: "slow" })).map((e) => e.uuid), ["c"]);
  assert.equal((await store.counts()).log, 1);
  assert.equal((await store.batch("b")).length, 2);
  assert.equal(await store.prune(now - 500), 1); // removes the older "a"
  await store.clear();
  assert.equal((await store.list({})).length, 0);
});

test("gate: closed in production, open when debugging, honors Watch.auth()", async () => {
  const app = new Application();
  const fakeCtx = {} as never;

  app.config().set("app.env", "production");
  app.config().set("app.debug", false);
  assert.equal(await passesGate(fakeCtx), false);

  app.config().set("app.debug", true);
  assert.equal(await passesGate(fakeCtx), true);

  app.config().set("app.debug", false);
  Watch.auth(() => true);
  assert.equal(await passesGate(fakeCtx), true);
  Watch.clearAuth();
});

test("WatchServiceProvider: wires config, migration, and routes", async () => {
  const app = new Application();
  await app.boot([WatchServiceProvider], {
    discoverConfig: false,
    config: { watch: { storage: "memory", path: "watch" }, app: { debug: true } },
  });

  const paths = app
    .make(Router)
    .all()
    .map((r) => r.path);
  assert.ok(paths.includes("/watch"), "dashboard route mounted");
  assert.ok(paths.includes("/watch/api/entries"), "entries API mounted");
  assert.ok(paths.some((p) => p.startsWith("/watch/assets")), "assets route mounted");
});

test("queue API: lists, retries, and flushes failed jobs", async () => {
  const { HttpKernel } = await import("../src/core/http/kernel.js");
  const { Job, MemoryDriver, setQueue, noBackoff } = await import("../src/core/queue.js");

  const app = new Application();
  await app.boot([WatchServiceProvider], {
    discoverConfig: false,
    config: { watch: { storage: "memory", path: "watch" }, app: { debug: true } },
  });
  const hono = new HttpKernel(app).build();

  let healed = false;
  class Sometimes extends Job {
    static override maxRetries = 0;
    static override backoff = noBackoff;
    async handle(): Promise<void> {
      if (!healed) throw new Error("broken dependency");
    }
  }

  const driver = new MemoryDriver();
  const queue = setQueue(driver);
  await queue.dispatch(new Sometimes());
  await queue.work();
  assert.equal(driver.failed.length, 1);

  // List
  const list = await hono.request("/watch/api/queue/failed");
  assert.equal(list.status, 200);
  const { failed } = (await list.json()) as { failed: { id: string; job: string; error: string }[] };
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.job, "Sometimes");
  assert.match(failed[0]!.error, /broken dependency/);

  // Retry — the instance goes back on the queue and succeeds this time.
  healed = true;
  const retry = await hono.request(`/watch/api/queue/failed/${failed[0]!.id}/retry`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.equal(driver.failed.length, 0);
  assert.equal(await queue.work(), 1);

  // Flush
  healed = false;
  await queue.dispatch(new Sometimes());
  await queue.work();
  const flush = await hono.request("/watch/api/queue/failed/all", { method: "DELETE" });
  assert.deepEqual(await flush.json(), { removed: 1 });
  assert.equal(driver.failed.length, 0);

  // Missing ids 404.
  const missing = await hono.request("/watch/api/queue/failed/nope/retry", { method: "POST" });
  assert.equal(missing.status, 404);
});
