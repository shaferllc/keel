import { test } from "node:test";
import assert from "node:assert/strict";

import { Events } from "../src/core/events.js";
import { Application } from "../src/core/application.js";
import { emit, listen, events } from "../src/core/helpers.js";

test("Events: on/emit/off/once/listenerCount/clear", async () => {
  const e = new Events();
  const seen: number[] = [];
  const unsub = e.on<number>("x", (p) => {
    seen.push(p);
  });
  await e.emit("x", 1);
  await e.emit("x", 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(e.listenerCount("x"), 1);

  unsub();
  await e.emit("x", 3);
  assert.deepEqual(seen, [1, 2]); // unsubscribed

  const onceSeen: number[] = [];
  e.once<number>("y", (p) => onceSeen.push(p));
  await e.emit("y", 1);
  await e.emit("y", 2);
  assert.deepEqual(onceSeen, [1]); // only the first

  e.on("z", () => {});
  e.clear("z");
  assert.equal(e.listenerCount("z"), 0);

  await e.emit("nothing"); // no listeners — no-op
});

test("Events: async listeners are awaited in order", async () => {
  const e = new Events();
  const order: string[] = [];
  e.on("e", async () => {
    await Promise.resolve();
    order.push("a");
  });
  e.on("e", () => {
    order.push("b");
  });
  await e.emit("e");
  assert.deepEqual(order, ["a", "b"]);
});

test("emit/listen helpers use the application's emitter", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  let got: unknown;
  listen("ping", (p) => {
    got = p;
  });
  await emit("ping", { a: 1 });
  assert.deepEqual(got, { a: 1 });
  assert.equal(events().listenerCount("ping"), 1);
});
