import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { ServiceProvider } from "../src/core/provider.js";

const boot = (app: Application) =>
  app.boot([], { discoverConfig: false, config: { app: {} } });

test("provider hooks fire in order: register → boot → ready, then shutdown (LIFO)", async () => {
  const order: string[] = [];

  class A extends ServiceProvider {
    register() { order.push("A.register"); }
    boot() { order.push("A.boot"); }
    ready() { order.push("A.ready"); }
    shutdown() { order.push("A.shutdown"); }
  }
  class B extends ServiceProvider {
    register() { order.push("B.register"); }
    boot() { order.push("B.boot"); }
    ready() { order.push("B.ready"); }
    shutdown() { order.push("B.shutdown"); }
  }

  const app = new Application();
  app.register(A);
  app.register(B);
  await boot(app);

  // All registers run before any boot; all boots before any ready.
  assert.deepEqual(order, [
    "A.register", "B.register",
    "A.boot", "B.boot",
    "A.ready", "B.ready",
  ]);

  order.length = 0;
  await app.terminate();
  // Shutdown runs in reverse registration order.
  assert.deepEqual(order, ["B.shutdown", "A.shutdown"]);
});

test("provider ready() sees a fully-booted app (other providers resolvable)", async () => {
  const TOKEN = Symbol("svc");
  let readSawBinding = false;

  class Binder extends ServiceProvider {
    register() { this.app.singleton(TOKEN, () => ({ ok: true })); }
  }
  class Reader extends ServiceProvider {
    ready() { readSawBinding = this.app.bound(TOKEN); }
  }

  const app = new Application();
  app.register(Binder);
  app.register(Reader);
  await boot(app);
  assert.equal(readSawBinding, true);
});

test("provider shutdown() runs alongside hand-registered onShutdown hooks", async () => {
  const order: string[] = [];
  class P extends ServiceProvider {
    boot() { this.app.onShutdown(() => { order.push("hook"); }); }
    shutdown() { order.push("shutdown"); }
  }
  const app = new Application();
  app.register(P);
  await boot(app);
  await app.terminate();
  // The manual hook was registered during boot (earlier), the provider
  // shutdown after boot — LIFO runs the provider shutdown first.
  assert.deepEqual(order, ["shutdown", "hook"]);
});

test("container: swap replaces a binding, restore puts the original back", async () => {
  const app = new Application();
  await boot(app);

  const KEY = "mailer";
  app.singleton(KEY, () => ({ kind: "real" }));
  assert.deepEqual(app.make(KEY), { kind: "real" });

  app.swap(KEY, () => ({ kind: "fake" }));
  assert.deepEqual(app.make(KEY), { kind: "fake" });
  assert.deepEqual(app.make(KEY), { kind: "fake" }); // swap is shared

  app.restore(KEY);
  assert.deepEqual(app.make(KEY), { kind: "real" });
});

test("container: swap remembers a pre-resolved instance across restore", async () => {
  const app = new Application();
  await boot(app);

  const KEY = "svc";
  const real = { id: 1 };
  app.instance(KEY, real);

  app.swap(KEY, () => ({ id: 2 }));
  assert.deepEqual(app.make(KEY), { id: 2 });

  app.restore(KEY);
  assert.equal(app.make(KEY), real); // same object identity restored
});

test("container: restore() with no token undoes every swap", async () => {
  const app = new Application();
  await boot(app);

  app.singleton("a", () => "A").singleton("b", () => "B");
  app.swap("a", () => "a*").swap("b", () => "b*");
  assert.equal(app.make("a"), "a*");
  assert.equal(app.make("b"), "b*");

  app.restore();
  assert.equal(app.make("a"), "A");
  assert.equal(app.make("b"), "B");
});

test("container: restoring a token that was unbound removes the swap binding", async () => {
  const app = new Application();
  await boot(app);

  assert.equal(app.bound("ghost"), false);
  app.swap("ghost", () => "boo");
  assert.equal(app.make("ghost"), "boo");

  app.restore("ghost");
  assert.equal(app.bound("ghost"), false);
});

test("container: alias resolves to the target and shares its singleton", async () => {
  class Router { readonly id = Symbol("router"); }
  const app = new Application();
  await boot(app);

  app.singleton(Router, () => new Router());
  app.alias("router", Router);

  const viaAlias = app.make<Router>("router");
  const viaClass = app.make(Router);
  assert.equal(viaAlias, viaClass); // same singleton instance
});
