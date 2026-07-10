import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { app as appHelper } from "../src/core/helpers.js";
import { Application } from "../src/core/application.js";

// This test runs first, in this file's own process, before any Application
// exists — exercising the "no application bootstrapped" guard.
test("app() throws before any application is created", () => {
  assert.throws(() => appHelper(), /No Keel application/);
});

test("boots config and env from the filesystem", async () => {
  const base = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const application = new Application(base);
  await application.boot([]); // discoverConfig defaults to true
  assert.equal(application.config().get("app.name"), "FromFs");
  assert.equal(process.env.KEEL_FS_TEST, "hello");
});

test("filesystem discovery is a no-op when the config dir is absent", async () => {
  const application = new Application("/does/not/exist");
  await application.boot([]); // loadEnv/loadConfig swallow the error
  assert.equal(application.config().get("app.anything", "fallback"), "fallback");
});
