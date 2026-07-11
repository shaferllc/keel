import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";

test("configure() runs the fn with the app and chains", () => {
  const app = new Application();
  const seen: Application[] = [];
  const ret = app
    .configure((a) => seen.push(a))
    .configure((a) => a.set("configured", true));
  assert.equal(ret, app);
  assert.equal(seen[0], app);
  assert.equal(app.get("configured"), true);
});

test("set()/get() share the config store", () => {
  const app = new Application();
  assert.equal(app.set("db.url", "sqlite://x"), app); // chainable
  assert.equal(app.get("db.url"), "sqlite://x");
  assert.equal(app.config().get("db.url"), "sqlite://x"); // same store
  assert.equal(app.get("missing", "fallback"), "fallback");
});

test("on()/emit() delegate to the Events singleton", async () => {
  const app = new Application();
  const got: string[] = [];
  const off = app.on<string>("user.registered", (name) => {
    got.push(name);
  });
  await app.emit("user.registered", "ada");
  off();
  await app.emit("user.registered", "grace"); // unsubscribed
  assert.deepEqual(got, ["ada"]);
});

test("once() fires a single time", async () => {
  const app = new Application();
  let n = 0;
  app.once("tick", () => {
    n++;
  });
  await app.emit("tick");
  await app.emit("tick");
  assert.equal(n, 1);
});
