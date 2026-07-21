import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { sessionMiddleware } from "../src/core/session.js";
import { auth, authGuard, setUserProvider } from "../src/core/auth.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "test-app-key" } } });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  kernel.use(sessionMiddleware());
  return kernel.build();
}

test("auth: login/check/id/user/logout across requests", async () => {
  setUserProvider((id) => ({ id, name: "Ada" }));
  const hono = await build((r) => {
    r.get("/login", () => {
      auth().login(42);
      return json({ ok: true });
    });
    r.get("/me", async () =>
      json({ check: auth().check(), id: auth().id(), user: await auth().user() }),
    );
    r.get("/logout", () => {
      auth().logout();
      return json({ ok: true });
    });
  });

  assert.deepEqual(await (await hono.request("/me")).json(), {
    check: false,
    id: null,
    user: null,
  });

  const cookie = (await hono.request("/login")).headers.get("set-cookie")!.split(";")[0];

  assert.deepEqual(await (await hono.request("/me", { headers: { cookie } })).json(), {
    check: true,
    id: "42",
    user: { id: "42", name: "Ada" },
  });

  const cookie2 = (await hono.request("/logout", { headers: { cookie } }))
    .headers.get("set-cookie")!
    .split(";")[0];
  const after = (await (await hono.request("/me", { headers: { cookie: cookie2 } })).json()) as {
    check: boolean;
  };
  assert.equal(after.check, false);
});

test("authGuard: 401 for guests, passes when authed, redirect option", async () => {
  const hono = await build((r) => {
    r.get("/login", () => {
      auth().login(1);
      return json({ ok: true });
    });
    r.get("/protected", json({ secret: true })).use(authGuard());
    r.get("/dash", json({ secret: true })).use(authGuard({ redirectTo: "/login" }));
  });

  assert.equal((await hono.request("/protected")).status, 401);

  const cookie = (await hono.request("/login")).headers.get("set-cookie")!.split(";")[0];
  assert.equal((await hono.request("/protected", { headers: { cookie } })).status, 200);

  const redirect = await hono.request("/dash");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/login");
});
