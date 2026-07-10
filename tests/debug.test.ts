import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { dump, dd } from "../src/core/debug.js";

test("dump returns its first value and logs", () => {
  const logs: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args);
  try {
    const out = dump({ a: 1 }, "extra");
    assert.deepEqual(out, { a: 1 });
    assert.equal(logs.length, 1);
  } finally {
    console.log = original;
  }
});

test("dd renders the values in the browser and halts the request", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/x", () => {
    dd({ user: "ada" }, [1, 2, 3]);
    return json({ never: true });
  });
  const hono = new HttpKernel(app).build();

  const res = await hono.request("/x");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /dump &amp; die/);
  assert.match(html, /"user": "ada"/);
});
