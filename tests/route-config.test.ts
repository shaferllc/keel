import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { json, request } from "../src/core/request.js";
import { testClient } from "../src/core/testing.js";

test("Route.config attaches metadata readable via request.route.config", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app
    .make(Router)
    .get("/dash", () => json({ config: request.route?.config }))
    .config({ scope: "admin", rateTier: "high" });

  const res = await testClient(app).get("/dash");
  res.assertJson({ config: { scope: "admin", rateTier: "high" } });
});

test("routes without config expose an empty object", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/", () => json({ config: request.route?.config }));
  const res = await testClient(app).get("/");
  res.assertJson({ config: {} });
});

test("group config applies to every route; a route's own config wins on conflict", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);

  router
    .group(() => {
      router.get("/a", () => json({ config: request.route?.config }));
      router
        .get("/b", () => json({ config: request.route?.config }))
        .config({ scope: "override" }); // route-level overrides group
    })
    .config({ scope: "team", area: "billing" });

  const client = testClient(app);
  (await client.get("/a")).assertJson({ config: { scope: "team", area: "billing" } });
  (await client.get("/b")).assertJson({ config: { scope: "override", area: "billing" } });
});

test("route/group middleware can branch on route config", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  const router = app.make(Router);

  const guard = async (c: { header(n: string, v: string): void }, next: () => Promise<void>) => {
    if (request.route?.config.public !== true) c.header("x-guard", "checked");
    await next();
  };

  router
    .group(() => {
      router.get("/private", () => json({ ok: true }));
      router.get("/public", () => json({ ok: true })).config({ public: true });
    })
    .use(guard);

  const client = testClient(app);
  (await client.get("/private")).assertHeader("x-guard", "checked");
  assert.equal((await client.get("/public")).header("x-guard"), null); // config.public bypassed the guard
});
