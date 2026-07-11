import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, response } from "../src/core/request.js";
import { testClient } from "../src/core/testing.js";

test("headers() sets several response headers at once", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/", () => {
    response.headers({ "x-a": "1", "x-b": "2" });
    return json({ ok: true });
  });

  const res = await testClient(app).get("/");
  res.assertHeader("x-a", "1").assertHeader("x-b", "2");
});

test("getHeader / hasHeader read a header set on the response", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  // A middleware that echoes a downstream header back after next().
  const kernel = new HttpKernel(app);
  kernel.use(async (_c, next) => {
    await next();
    if (response.hasHeader("x-source")) {
      response.header("x-echoed", response.getHeader("x-source")!);
    }
  });
  app.make(Router).get("/", () => {
    response.header("x-source", "handler");
    return json({ ok: true });
  });

  const res = await testClient(kernel).get("/");
  res.assertHeader("x-source", "handler");
  res.assertHeader("x-echoed", "handler"); // middleware read it via getHeader
});

test("hasHeader is false for an unset header", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  let seen: boolean | undefined;
  const kernel = new HttpKernel(app);
  kernel.use(async (_c, next) => {
    await next();
    seen = response.hasHeader("x-absent");
  });
  app.make(Router).get("/", () => json({ ok: true }));

  await testClient(kernel).get("/");
  assert.equal(seen, false);
});
