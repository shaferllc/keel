import { test } from "node:test";
import assert from "node:assert/strict";

import { Broker } from "../src/core/broker.js";

test("retries recover from transient failures", async () => {
  let attempts = 0;
  const b = new Broker();
  b.createService({
    name: "flaky",
    actions: {
      go() {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
    },
  });
  await b.start();

  const res = await b.call("flaky.go", null, { retries: 3 });
  assert.equal(res, "ok");
  assert.equal(attempts, 3); // failed twice, succeeded on the third
  await b.stop();
});

test("without retries a failure propagates", async () => {
  const b = new Broker();
  b.createService({ name: "s", actions: { boom: () => { throw new Error("nope"); } } });
  await b.start();
  await assert.rejects(() => b.call("s.boom"), /nope/);
  await b.stop();
});

test("fallback value / function is used when every attempt fails", async () => {
  const b = new Broker();
  b.createService({ name: "s", actions: { boom: () => { throw new Error("down"); } } });
  await b.start();

  assert.deepEqual(await b.call("s.boom", null, { fallback: { cached: true } }), { cached: true });
  const viaFn = await b.call("s.boom", null, { fallback: (err: Error) => `fallback: ${err.message}` });
  assert.equal(viaFn, "fallback: down");
  await b.stop();
});

test("retries + fallback: retry first, fall back only after exhaustion", async () => {
  let attempts = 0;
  const b = new Broker({ retries: 2 }); // broker-level default
  b.createService({
    name: "s",
    actions: {
      go() {
        attempts++;
        throw new Error("always");
      },
    },
  });
  await b.start();
  assert.equal(await b.call("s.go", null, { fallback: "safe" }), "safe");
  assert.equal(attempts, 3); // 1 + 2 retries
  await b.stop();
});

test("registry introspection: has / list / get", async () => {
  const b = new Broker();
  b.createService({ name: "math", actions: { add: () => 0, sub: () => 0 } });
  b.createService({ name: "users", actions: { find: () => 0 } });
  await b.start();

  assert.equal(b.hasAction("math.add"), true);
  assert.equal(b.hasAction("math.nope"), false);
  assert.deepEqual(b.listActions(), ["math.add", "math.sub", "users.find"]);
  assert.deepEqual(b.listServices().sort(), ["math", "users"]);
  assert.equal(b.getService("math")?.name, "math");
  assert.equal(b.getService("nope"), undefined);
  await b.stop();
});
