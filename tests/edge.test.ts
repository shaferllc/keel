import { test } from "node:test";
import assert from "node:assert/strict";

import { Config } from "../src/core/config.js";
import { validate } from "../src/core/validation.js";
import { ValidationException, HttpException } from "../src/core/exceptions.js";
import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";

test("config.set overwrites a non-object segment", () => {
  const cfg = new Config();
  cfg.set("a.b", 1);
  cfg.set("a.b.c", 2); // b (a number) must be replaced by an object
  assert.equal(cfg.get("a.b.c"), 2);
});

test("validation maps a root (empty-path) issue to _", async () => {
  const schema = {
    safeParse() {
      return {
        success: false as const,
        error: { issues: [{ path: [] as PropertyKey[], message: "bad" }] },
      };
    },
  };
  await assert.rejects(
    () => validate(schema, {}),
    (e: unknown) => {
      assert.deepEqual((e as ValidationException).errors, { _: ["bad"] });
      return true;
    },
  );
});

test("HttpException headers are applied to the error response", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { debug: false } } });
  app.make(Router).get("/x", () => {
    throw new HttpException(503, "down", { "retry-after": "5" });
  });
  const hono = new HttpKernel(app).build();
  const res = await hono.request("/x", { headers: { accept: "application/json" } });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "5");
});
