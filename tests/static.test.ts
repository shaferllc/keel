import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { serveStatic, type StaticOptions } from "../src/core/static.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "public");

async function build(opts: StaticOptions = {}) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/api", () => json({ route: true }));
  const kernel = new HttpKernel(app);
  kernel.use(serveStatic({ root: publicDir, maxAge: 3600, ...opts }));
  return kernel.build();
}

test("serves a file with mime + caching headers", async () => {
  const hono = await build();
  const res = await hono.request("/hello.txt");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hi there");
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  assert.ok(res.headers.get("etag"));
  assert.ok(res.headers.get("last-modified"));
  assert.match(res.headers.get("cache-control") ?? "", /max-age=3600/);
});

test("serves index.html for a directory", async () => {
  const hono = await build();
  const res = await hono.request("/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /home/);
});

test("falls through to routes / 404 when no file matches", async () => {
  const hono = await build();
  assert.deepEqual(await (await hono.request("/api")).json(), { route: true });
  assert.equal((await hono.request("/nope.txt")).status, 404);
});

test("dotfiles: ignored (404) by default, denied with deny", async () => {
  assert.equal((await (await build()).request("/.secret")).status, 404);
  assert.equal((await (await build({ dotFiles: "deny" })).request("/.secret")).status, 403);
});

test("304 on matching If-None-Match", async () => {
  const hono = await build();
  const etag = (await hono.request("/hello.txt")).headers.get("etag")!;
  const res = await hono.request("/hello.txt", { headers: { "If-None-Match": etag } });
  assert.equal(res.status, 304);
});

test("path traversal is blocked", async () => {
  const hono = await build();
  assert.equal((await hono.request("/%2e%2e/%2e%2e/package.json")).status, 404);
});
