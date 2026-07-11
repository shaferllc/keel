import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { ServiceProvider } from "../src/core/provider.js";

test("a provider receives options passed to register()", async () => {
  const seen: { phase: string; max: number }[] = [];

  class RateLimitProvider extends ServiceProvider<{ max: number }> {
    register() {
      seen.push({ phase: "register", max: this.options.max });
    }
    boot() {
      seen.push({ phase: "boot", max: this.options.max });
    }
  }

  const app = new Application();
  app.register(RateLimitProvider, { max: 100 });
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  assert.deepEqual(seen, [
    { phase: "register", max: 100 },
    { phase: "boot", max: 100 },
  ]);
});

test("options default to an empty object when none are passed", async () => {
  let captured: unknown;
  class P extends ServiceProvider {
    register() {
      captured = this.options;
    }
  }
  const app = new Application();
  app.register(P);
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  assert.deepEqual(captured, {});
});

test("the same provider class registers twice with different options", async () => {
  const maxes: number[] = [];
  class P extends ServiceProvider<{ max: number }> {
    boot() {
      maxes.push(this.options.max);
    }
  }
  const app = new Application();
  app.register(P, { max: 10 });
  app.register(P, { max: 20 });
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  assert.deepEqual(maxes.sort((a, b) => a - b), [10, 20]);
});

test("providers passed to boot([...]) still work (no options)", async () => {
  let ran = false;
  class P extends ServiceProvider {
    boot() {
      ran = true;
    }
  }
  const app = new Application();
  await app.boot([P], { discoverConfig: false, config: { app: {} } });
  assert.equal(ran, true);
});
