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
