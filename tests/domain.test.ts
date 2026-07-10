import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, request } from "../src/core/request.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("domain routing dispatches by host and captures subdomains", async () => {
  const hono = await build((r) => {
    r.get("/", () => json({ where: "main" }));
    r.group(() => {
      r.get("/", () => json({ tenant: request.subdomain("tenant") }));
    }).domain(":tenant.example.com");
  });

  const main = await hono.request("/", { headers: { host: "example.com" } });
  assert.deepEqual(await main.json(), { where: "main" });

  const sub = await hono.request("/", { headers: { host: "acme.example.com" } });
  assert.deepEqual(await sub.json(), { tenant: "acme" });
});

test("request.routeIs and request.route reflect the matched route", async () => {
  const hono = await build((r) => {
    r.get("/p", () =>
      json({ is: request.routeIs("posts.index"), name: request.route?.name }),
    ).name("posts.index");
  });
  const res = await hono.request("/p");
  assert.deepEqual(await res.json(), { is: true, name: "posts.index" });
});
