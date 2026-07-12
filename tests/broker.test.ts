import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Broker,
  ServiceNotFoundError,
  RequestTimeoutError,
  broker,
  setBroker,
  type Context,
  type Transporter,
} from "../src/core/broker.js";

test("call runs an action and returns its result", async () => {
  const b = new Broker();
  b.createService({
    name: "math",
    actions: {
      add: (ctx: Context<{ a: number; b: number }>) => ctx.params.a + ctx.params.b,
    },
  });
  await b.start();
  assert.equal(await b.call("math.add", { a: 2, b: 3 }), 5);
});

test("unknown actions throw ServiceNotFoundError", async () => {
  const b = new Broker();
  await assert.rejects(() => b.call("nope.missing"), ServiceNotFoundError);
});

test("versioned services get a v-prefixed name", async () => {
  const b = new Broker();
  b.createService({
    name: "posts",
    version: 2,
    actions: { list: () => ["a", "b"] },
  });
  assert.deepEqual(await b.call("v2.posts.list"), ["a", "b"]);
  assert.ok(b.getLocalService("v2.posts"));
  assert.ok(b.getLocalService("posts"));
});

test("ctx.call chains actions and inherits meta", async () => {
  const b = new Broker();
  const seen: unknown[] = [];
  b.createService({
    name: "inner",
    actions: {
      whoami: (ctx: Context) => {
        seen.push(ctx.meta.user);
        return ctx.meta.user;
      },
    },
  });
  b.createService({
    name: "outer",
    actions: {
      run: (ctx: Context) => ctx.call("inner.whoami"),
    },
  });
  const result = await b.call("outer.run", {}, { meta: { user: "ada" } });
  assert.equal(result, "ada");
  assert.deepEqual(seen, ["ada"]);
});

test("methods and settings are reachable via this", async () => {
  const b = new Broker();
  b.createService({
    name: "greeter",
    settings: { greeting: "Hi" },
    methods: {
      shout(this: any, name: string) {
        return `${this.settings.greeting}, ${name}!`;
      },
    },
    actions: {
      hello(this: any, ctx: Context<{ name: string }>) {
        return this.shout(ctx.params.name);
      },
    },
  });
  assert.equal(await b.call("greeter.hello", { name: "Ada" }), "Hi, Ada!");
});

test("emit fans out to every listening service", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({ name: "audit", events: { "user.created": (ctx: Context) => void hits.push(`audit:${(ctx.params as any).id}`) } });
  b.createService({ name: "mailer", events: { "user.created": (ctx: Context) => void hits.push(`mailer:${(ctx.params as any).id}`) } });
  await b.emit("user.created", { id: 7 });
  assert.deepEqual(hits.sort(), ["audit:7", "mailer:7"]);
});

test("event patterns support globs", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({ name: "watcher", events: { "user.*": (ctx: Context) => void hits.push(ctx.name) } });
  await b.emit("user.created");
  await b.emit("user.deleted");
  await b.emit("post.created"); // no match
  assert.deepEqual(hits, ["user.created", "user.deleted"]);
  assert.equal(b.hasEventListener("user.updated"), true);
  assert.equal(b.hasEventListener("order.paid"), false);
});

test("lifecycle hooks fire on start and stop", async () => {
  const b = new Broker();
  const log: string[] = [];
  b.createService({
    name: "svc",
    created() {
      log.push("created");
    },
    async started() {
      log.push("started");
    },
    async stopped() {
      log.push("stopped");
    },
  });
  assert.deepEqual(log, ["created"]);
  await b.start();
  assert.deepEqual(log, ["created", "started"]);
  await b.stop();
  assert.deepEqual(log, ["created", "started", "stopped"]);
});

test("call honors a timeout", async () => {
  const b = new Broker();
  b.createService({
    name: "slow",
    actions: {
      wait: () => new Promise((res) => setTimeout(res, 50)),
    },
  });
  await assert.rejects(() => b.call("slow.wait", {}, { timeout: 5 }), RequestTimeoutError);
});

test("destroyService unregisters actions", async () => {
  const b = new Broker();
  const svc = b.createService({ name: "temp", actions: { ping: () => "pong" } });
  assert.equal(await b.call("temp.ping"), "pong");
  await b.destroyService(svc);
  await assert.rejects(() => b.call("temp.ping"), ServiceNotFoundError);
});

test("a custom transporter is connected and disconnected", async () => {
  const events: string[] = [];
  const transporter: Transporter = {
    async connect() {
      events.push("connect");
    },
    async disconnect() {
      events.push("disconnect");
    },
  };
  const b = new Broker({ transporter, nodeID: "n1" });
  await b.start();
  await b.stop();
  assert.deepEqual(events, ["connect", "disconnect"]);
  assert.equal(b.nodeID, "n1");
});

test("ping returns local timings", async () => {
  const b = new Broker({ nodeID: "local" });
  assert.deepEqual(await b.ping(), { nodeID: "local", elapsedTime: 0, timeDiff: 0 });
});

test("global broker() / setBroker()", async () => {
  const custom = new Broker({ nodeID: "custom" });
  const returned = setBroker(custom);
  assert.equal(returned, custom);
  assert.equal(broker().nodeID, "custom");
});

/* ------------------------------- action defs ------------------------------ */

test("actions accept the full definition form", async () => {
  const b = new Broker();
  b.createService({
    name: "reports",
    actions: {
      build: {
        handler: (ctx: Context<{ id: number }>) => `report-${ctx.params.id}`,
      },
    },
  });
  assert.equal(await b.call("reports.build", { id: 3 }), "report-3");
});

test("private actions are hidden from call but reachable internally", async () => {
  const b = new Broker();
  b.createService({
    name: "billing",
    actions: {
      charge: {
        visibility: "private",
        handler: (ctx: Context<{ cents: number }>) => ctx.params.cents,
      },
      checkout(this: any, ctx: Context<{ cents: number }>) {
        return this.actions.charge({ cents: ctx.params.cents });
      },
    },
  });
  await assert.rejects(() => b.call("billing.charge", { cents: 100 }), ServiceNotFoundError);
  assert.equal(await b.call("billing.checkout", { cents: 100 }), 100);
});

test("action-level timeout rejects with RequestTimeoutError", async () => {
  const b = new Broker();
  b.createService({
    name: "slow",
    actions: {
      wait: { timeout: 5, handler: () => new Promise((res) => setTimeout(res, 50)) },
    },
  });
  await assert.rejects(() => b.call("slow.wait"), RequestTimeoutError);
});

/* --------------------------------- hooks ---------------------------------- */

test("service and action hooks run in the documented order", async () => {
  const b = new Broker();
  const order: string[] = [];
  b.createService({
    name: "posts",
    hooks: {
      before: {
        "*": () => void order.push("before:*"),
        create: () => void order.push("before:create"),
      },
      after: {
        "*": (_ctx: Context, res: any) => (order.push("after:*"), res),
        create: (_ctx: Context, res: any) => (order.push("after:create"), res),
      },
    },
    actions: {
      create: {
        hooks: {
          before: () => void order.push("before:action"),
          after: (_ctx: Context, res: any) => (order.push("after:action"), res),
        },
        handler: () => (order.push("handler"), "ok"),
      },
    },
  });
  const res = await b.call("posts.create");
  assert.equal(res, "ok");
  assert.deepEqual(order, [
    "before:*",
    "before:create",
    "before:action",
    "handler",
    "after:action",
    "after:create",
    "after:*",
  ]);
});

test("before hooks mutate params, after hooks transform the result", async () => {
  const b = new Broker();
  b.createService({
    name: "users",
    hooks: {
      before: { "*": (ctx: Context<any>) => void (ctx.params.name = ctx.params.name.trim()) },
      after: { get: (_ctx: Context, res: any) => ({ ...res, wrapped: true }) },
    },
    actions: {
      get: (ctx: Context<{ name: string }>) => ({ name: ctx.params.name }),
    },
  });
  assert.deepEqual(await b.call("users.get", { name: "  ada  " }), { name: "ada", wrapped: true });
});

test("error hooks can recover or re-throw", async () => {
  const b = new Broker();
  b.createService({
    name: "risky",
    hooks: {
      error: { safe: () => "fallback" },
    },
    actions: {
      safe: () => {
        throw new Error("boom");
      },
      unsafe: () => {
        throw new Error("kaboom");
      },
    },
  });
  assert.equal(await b.call("risky.safe"), "fallback");
  await assert.rejects(() => b.call("risky.unsafe"), /kaboom/);
});

/* ------------------------- locals, headers, requestID --------------------- */

test("locals pass data between hooks and handler; headers stay per-call", async () => {
  const b = new Broker();
  let seenHeader: unknown;
  b.createService({
    name: "svc",
    hooks: { before: { "*": (ctx: Context) => void (ctx.locals.tenant = "acme") } },
    actions: {
      inner: (ctx: Context) => ctx.headers.trace ?? null,
      outer(ctx: Context) {
        seenHeader = ctx.headers.trace;
        return ctx.call("svc.inner"); // headers are NOT propagated
      },
    },
  });
  const tenant = await b.call("svc.inner", {}, {}).then(() => null);
  assert.equal(tenant, null);
  const nested = await b.call("svc.outer", {}, { headers: { trace: "abc" } });
  assert.equal(seenHeader, "abc");
  assert.equal(nested, null); // inner did not inherit the header
});

test("requestID is generated once and propagates to nested calls", async () => {
  const b = new Broker();
  const ids: string[] = [];
  b.createService({
    name: "chain",
    actions: {
      leaf: (ctx: Context) => void ids.push(ctx.requestID),
      root(ctx: Context) {
        ids.push(ctx.requestID);
        return ctx.call("chain.leaf");
      },
    },
  });
  await b.call("chain.root", {}, { requestID: "req-1" });
  assert.deepEqual(ids, ["req-1", "req-1"]);
});

/* --------------------------------- mcall ---------------------------------- */

test("mcall runs an array and a keyed map of calls", async () => {
  const b = new Broker();
  b.createService({
    name: "math",
    actions: {
      double: (ctx: Context<{ n: number }>) => ctx.params.n * 2,
      square: (ctx: Context<{ n: number }>) => ctx.params.n ** 2,
    },
  });
  const arr = await b.mcall([
    { action: "math.double", params: { n: 3 } },
    { action: "math.square", params: { n: 3 } },
  ]);
  assert.deepEqual(arr, [6, 9]);

  const map = await b.mcall({
    d: { action: "math.double", params: { n: 4 } },
    s: { action: "math.square", params: { n: 4 } },
  });
  assert.deepEqual(map, { d: 8, s: 16 });
});

test("mcall with settled reports per-call status", async () => {
  const b = new Broker();
  b.createService({
    name: "svc",
    actions: {
      ok: () => "yes",
      boom: () => {
        throw new Error("no");
      },
    },
  });
  const res = (await b.mcall(
    [{ action: "svc.ok" }, { action: "svc.boom" }],
    { settled: true },
  )) as Array<{ status: string; value?: unknown; reason?: Error }>;
  assert.equal(res[0]!.status, "fulfilled");
  assert.equal(res[0]!.value, "yes");
  assert.equal(res[1]!.status, "rejected");
  assert.match((res[1]!.reason as Error).message, /no/);
});

/* ------------------------- metadata & dependencies ------------------------ */

test("metadata is exposed on the service instance", async () => {
  const b = new Broker();
  const svc = b.createService({
    name: "svc",
    metadata: { region: "us-east" },
    actions: { where: (ctx: Context) => ctx.service.metadata.region },
  });
  assert.equal(svc.metadata.region, "us-east");
  assert.equal(await b.call("svc.where"), "us-east");
});

test("dependencies delay a service's started hook until deps are present", async () => {
  const b = new Broker();
  const order: string[] = [];
  b.createService({ name: "db", async started() { order.push("db"); } });
  b.createService({
    name: "api",
    dependencies: "db",
    async started() {
      order.push("api");
    },
  });
  await b.start();
  assert.deepEqual(order, ["db", "api"]);
});

test("waitForServices times out when a dependency never registers", async () => {
  const b = new Broker();
  await assert.rejects(() => b.waitForServices("ghost", 20, 5), /timed out/);
});

/* ------------------------------ event groups ------------------------------ */

test("event listeners can declare a group that emit can target", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({
    name: "audit",
    events: { "user.created": { group: "logging", handler: () => void hits.push("audit") } },
  });
  b.createService({
    name: "mailer",
    events: { "user.created": { group: "notify", handler: () => void hits.push("mailer") } },
  });
  await b.emit("user.created", {}, { groups: ["notify"] });
  assert.deepEqual(hits, ["mailer"]);
});

/* --------------------------------- mixins --------------------------------- */

test("mixins merge actions, settings, and chain lifecycle hooks", async () => {
  const b = new Broker();
  const order: string[] = [];
  const timestamps = {
    name: "timestamps",
    settings: { softDelete: false },
    actions: { touch: () => "touched" },
    created() {
      order.push("mixin:created");
    },
  };
  b.createService({
    mixins: [timestamps],
    name: "articles",
    settings: { perPage: 10 },
    actions: { list: () => ["a"] },
    created() {
      order.push("own:created");
    },
  });
  // both actions callable
  assert.equal(await b.call("articles.touch"), "touched");
  assert.deepEqual(await b.call("articles.list"), ["a"]);
  // settings deep-merged
  const svc = b.getLocalService("articles")!;
  assert.deepEqual(svc.settings, { softDelete: false, perPage: 10 });
  // lifecycle chained, mixin first
  assert.deepEqual(order, ["mixin:created", "own:created"]);
});

test("the service schema wins over its mixins on conflict, and merged() fires", async () => {
  const b = new Broker();
  let mergedName = "";
  const base = {
    name: "base",
    actions: { greet: () => "from-mixin" },
  };
  b.createService({
    mixins: [base],
    name: "app",
    actions: { greet: () => "from-service" },
    merged(schema) {
      mergedName = schema.name;
    },
  });
  assert.equal(await b.call("app.greet"), "from-service");
  assert.equal(mergedName, "app");
});

/* ---------------------------- events (extended) --------------------------- */

test("broadcastLocal reaches every local listener", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({ name: "a", events: { "cache.flush": () => void hits.push("a") } });
  b.createService({ name: "b", events: { "cache.flush": () => void hits.push("b") } });
  await b.broadcastLocal("cache.flush");
  assert.deepEqual(hits.sort(), ["a", "b"]);
});

test("event patterns support the ? single-char wildcard", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({ name: "w", events: { "user.??eated": (ctx: Context) => void hits.push(ctx.name) } });
  await b.emit("user.created"); // "cr" + "eated" ✓
  await b.emit("user.updated"); // "up" + "dated" ✗
  assert.deepEqual(hits, ["user.created"]);
});

test("event context carries eventName, eventType, and groups", async () => {
  const b = new Broker();
  const seen: Array<{ name?: string; type?: string; groups?: string[] }> = [];
  b.createService({
    name: "audit",
    events: {
      "user.created": {
        group: "log",
        handler: (ctx: Context) =>
          void seen.push({ name: ctx.eventName, type: ctx.eventType, groups: ctx.eventGroups }),
      },
    },
  });
  await b.emit("user.created");
  await b.broadcast("user.created");
  assert.deepEqual(seen[0], { name: "user.created", type: "emit", groups: ["log"] });
  assert.equal(seen[1]!.type, "broadcast");
});

test("internal lifecycle events fire on start/stop and service changes", async () => {
  const b = new Broker();
  const hits: string[] = [];
  b.createService({
    name: "watch",
    events: {
      "$broker.started": () => void hits.push("started"),
      "$broker.stopped": () => void hits.push("stopped"),
      "$services.changed": (ctx: Context) => void hits.push(`changed:${(ctx.params as any).service}`),
    },
  });
  b.createService({ name: "extra", actions: { noop: () => 1 } });
  await b.start();
  await b.stop();
  assert.ok(hits.includes("started"));
  assert.ok(hits.includes("stopped"));
  assert.ok(hits.includes("changed:extra"));
});

/* --------------------------- context (extended) --------------------------- */

test("nested calls track parentID, level, and caller", async () => {
  const b = new Broker();
  const frames: Array<{ level: number; parentID: string | null; caller: string | null }> = [];
  b.createService({
    name: "leaf",
    actions: {
      deep: (ctx: Context) => {
        frames.push({ level: ctx.level, parentID: ctx.parentID, caller: ctx.caller });
        return ctx.level;
      },
    },
  });
  b.createService({
    name: "mid",
    actions: {
      go(ctx: Context) {
        frames.push({ level: ctx.level, parentID: ctx.parentID, caller: ctx.caller });
        return ctx.call("leaf.deep");
      },
    },
  });
  const depth = await b.call("mid.go");
  assert.equal(depth, 2);
  assert.deepEqual(frames[0], { level: 1, parentID: null, caller: null });
  assert.equal(frames[1]!.level, 2);
  assert.equal(frames[1]!.caller, "mid");
  assert.equal(typeof frames[1]!.parentID, "string");
});

test("ctx.toJSON returns a serializable snapshot without live refs", async () => {
  const b = new Broker();
  let snap: Record<string, unknown> = {};
  b.createService({
    name: "svc",
    actions: {
      snapshot: (ctx: Context) => {
        snap = ctx.toJSON();
        return snap;
      },
    },
  });
  await b.call("svc.snapshot", { x: 1 }, { requestID: "req-9" });
  assert.equal(snap.requestID, "req-9");
  assert.equal(snap.level, 1);
  assert.equal(snap.name, "svc.snapshot");
  assert.equal(typeof snap.id, "string");
  assert.equal(snap.broker, undefined);
  assert.doesNotThrow(() => JSON.stringify(snap));
});
