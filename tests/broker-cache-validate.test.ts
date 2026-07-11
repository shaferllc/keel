import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { Broker } from "../src/core/broker.js";
import { Cache } from "../src/core/cache.js";
import { ValidationException } from "../src/core/exceptions.js";

test("action params are validated (and coerced) before the handler", async () => {
  const b = new Broker();
  b.createService({
    name: "users",
    actions: {
      create: {
        params: z.object({ email: z.string().email(), age: z.coerce.number().min(18) }),
        handler: (ctx: { params: { email: string; age: number } }) => ctx.params.age,
      },
    },
  });
  await b.start();

  assert.equal(await b.call("users.create", { email: "a@b.com", age: "42" }), 42); // coerced to number
  await assert.rejects(
    () => b.call("users.create", { email: "nope", age: 10 }),
    (e) => e instanceof ValidationException,
  );
  await b.stop();
});

test("cached actions run the handler once per key", async () => {
  let calls = 0;
  const b = new Broker({ cacher: new Cache() });
  b.createService({
    name: "stats",
    actions: {
      totals: {
        cache: { ttl: 60 },
        handler: (ctx: { params: { day: string } }) => {
          calls++;
          return { day: ctx.params.day, n: calls };
        },
      },
    },
  });
  await b.start();

  const a1 = await b.call("stats.totals", { day: "mon" });
  const a2 = await b.call("stats.totals", { day: "mon" }); // cache hit
  const b1 = await b.call("stats.totals", { day: "tue" }); // different key
  assert.deepEqual(a1, a2);
  assert.equal(calls, 2); // "mon" once, "tue" once
  assert.deepEqual(b1, { day: "tue", n: 2 });
  await b.stop();
});

test("cache keys can be limited to a subset of params", async () => {
  let calls = 0;
  const b = new Broker({ cacher: new Cache() });
  b.createService({
    name: "s",
    actions: {
      get: {
        cache: { keys: ["id"] }, // ignore other params in the key
        handler: () => ++calls,
      },
    },
  });
  await b.start();
  await b.call("s.get", { id: 1, trace: "x" });
  await b.call("s.get", { id: 1, trace: "y" }); // same id → cache hit despite different trace
  assert.equal(calls, 1);
  await b.stop();
});

test("no cacher → cache option is a no-op (handler runs every time)", async () => {
  let calls = 0;
  const b = new Broker(); // no cacher
  b.createService({ name: "s", actions: { go: { cache: true, handler: () => ++calls } } });
  await b.start();
  await b.call("s.go");
  await b.call("s.go");
  assert.equal(calls, 2);
  await b.stop();
});
