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

/* ---------------------------- error handling ------------------------------ */

test("one listener throwing does not stop the others", async () => {
  const e = new Events();
  const ran: string[] = [];

  e.on("x", () => {
    ran.push("first");
  });
  e.on("x", () => {
    throw new Error("boom");
  });
  e.on("x", () => {
    ran.push("third");
  });

  // The failure still surfaces...
  await assert.rejects(() => e.emit("x"), /boom/);
  // ...but the listener after the throwing one ran anyway.
  assert.deepEqual(ran, ["first", "third"]);
});

test("several failures reject with an AggregateError", async () => {
  const e = new Events();
  e.on("x", () => {
    throw new Error("one");
  });
  e.on("x", async () => {
    throw new Error("two");
  });

  await assert.rejects(
    () => e.emit("x"),
    (err: unknown) => {
      assert.ok(err instanceof AggregateError);
      assert.equal(err.errors.length, 2);
      assert.deepEqual(
        err.errors.map((x: Error) => x.message),
        ["one", "two"],
      );
      return true;
    },
  );
});

test("onError swallows the rejection and receives event, error, and payload", async () => {
  const e = new Events();
  const caught: Array<{ event: string; message: string; payload: unknown }> = [];

  e.onError((event, error, payload) => {
    caught.push({ event, message: (error as Error).message, payload });
  });
  e.on("x", () => {
    throw new Error("boom");
  });

  await e.emit("x", { id: 1 }); // does not reject
  assert.deepEqual(caught, [{ event: "x", message: "boom", payload: { id: 1 } }]);
});

test("a rejected promise from an async listener is handled like a throw", async () => {
  const e = new Events();
  e.on("x", () => Promise.reject(new Error("async-boom")));
  await assert.rejects(() => e.emit("x"), /async-boom/);
});

/* --------------------------------- onAny ---------------------------------- */

test("onAny sees every event, before the event's own listeners", async () => {
  const e = new Events();
  const order: string[] = [];
  const seen: Array<[string, unknown]> = [];

  e.onAny((event, payload) => {
    order.push("any");
    seen.push([event, payload]);
  });
  e.on("a", () => {
    order.push("a-listener");
  });

  await e.emit("a", 1);
  await e.emit("b", 2);

  assert.deepEqual(seen, [
    ["a", 1],
    ["b", 2],
  ]);
  assert.deepEqual(order, ["any", "a-listener", "any"]);
});

test("onAny returns an unsubscribe function", async () => {
  const e = new Events();
  let count = 0;
  const off = e.onAny(() => {
    count++;
  });

  await e.emit("x");
  off();
  await e.emit("x");

  assert.equal(count, 1);
});

test("clearAll drops listeners, onAny listeners, and the error handler", async () => {
  const e = new Events();
  let any = 0;
  let errors = 0;

  e.onAny(() => {
    any++;
  });
  e.onError(() => {
    errors++;
  });
  e.on("x", () => {
    throw new Error("boom");
  });

  e.clearAll();

  await e.emit("x"); // no listeners left, so nothing throws and nothing counts
  assert.equal(any, 0);
  assert.equal(errors, 0);
  assert.equal(e.listenerCount("x"), 0);
});

/* --------------------------------- faking --------------------------------- */

test("fake records emissions instead of running listeners", async () => {
  const e = new Events();
  let ran = false;
  e.on("user.registered", () => {
    ran = true;
  });

  const buffer = e.fake();
  await e.emit("user.registered", { id: 1 });

  assert.equal(ran, false); // the side effect never happened
  buffer.assertEmitted("user.registered");
  assert.deepEqual(buffer.all(), [{ event: "user.registered", payload: { id: 1 } }]);

  e.restore();
  await e.emit("user.registered", { id: 2 });
  assert.equal(ran, true); // real again
});

test("fake can target only some events; the rest dispatch for real", async () => {
  const e = new Events();
  const ran: string[] = [];
  e.on("faked", () => ran.push("faked"));
  e.on("real", () => ran.push("real"));

  const buffer = e.fake("faked");
  await e.emit("faked");
  await e.emit("real");

  assert.deepEqual(ran, ["real"]);
  buffer.assertEmitted("faked");
  buffer.assertNotEmitted("real"); // it wasn't intercepted, so it wasn't recorded
});

test("fake accepts a list of events", async () => {
  const e = new Events();
  const ran: string[] = [];
  e.on("a", () => ran.push("a"));
  e.on("b", () => ran.push("b"));
  e.on("c", () => ran.push("c"));

  const buffer = e.fake(["a", "b"]);
  await e.emit("a");
  await e.emit("b");
  await e.emit("c");

  assert.deepEqual(ran, ["c"]);
  buffer.assertEmittedCount("a", 1);
  buffer.assertEmittedCount("b", 1);
});

test("buffer assertions pass and fail as expected", async () => {
  const e = new Events();
  const buffer = e.fake();

  await e.emit("order.paid", { id: 1, total: 4200 });
  await e.emit("order.paid", { id: 2, total: 10 });

  buffer.assertEmitted("order.paid");
  buffer.assertEmitted("order.paid", (o) => (o as { total: number }).total === 4200);
  buffer.assertEmittedCount("order.paid", 2);
  buffer.assertNotEmitted("order.refunded");
  assert.deepEqual(buffer.payloadsFor("order.paid"), [
    { id: 1, total: 4200 },
    { id: 2, total: 10 },
  ]);

  assert.throws(() => buffer.assertNotEmitted("order.paid"), /it fired 2 time\(s\)/);
  assert.throws(() => buffer.assertEmitted("order.refunded"), /to be emitted, but it was not/);
  assert.throws(() => buffer.assertEmittedCount("order.paid", 5), /5 time\(s\), but it fired 2/);
  assert.throws(() => buffer.assertNoneEmitted(), /Expected no events, but 2 fired/);
  assert.throws(
    () => buffer.assertEmitted("order.paid", (o) => (o as { total: number }).total === 999),
    /It fired 2 time\(s\), but none matched/,
  );
});

test("assertNoneEmitted passes on an untouched buffer", () => {
  const e = new Events();
  e.fake().assertNoneEmitted();
});
