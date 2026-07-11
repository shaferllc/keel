import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { jwt } from "../src/core/crypto.js";
import { auth, bearerAuth, setUserProvider } from "../src/core/auth.js";

/** Boot an app so `config('app.key')` (used to sign/verify) is available. */
async function boot(key = "test-secret-key") {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key } } });
  return app;
}

/** base64url without padding — for hand-forging tokens in tests. */
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

test("jwt: sign/verify round-trips claims and stamps iat", async () => {
  await boot();
  const token = await jwt.sign({ sub: "42", role: "admin" });
  assert.equal(token.split(".").length, 3);

  const payload = await jwt.verify(token);
  assert.ok(payload);
  assert.equal(payload.sub, "42");
  assert.equal(payload.role, "admin");
  assert.equal(typeof payload.iat, "number");
  assert.equal(payload.exp, undefined); // no expiresIn → no exp
});

test("jwt: subject/issuer/audience options and duration expiry", async () => {
  await boot();
  const token = await jwt.sign(
    {},
    { subject: "7", issuer: "keel", audience: "api", expiresIn: "1h" },
  );
  const payload = await jwt.verify(token);
  assert.ok(payload);
  assert.equal(payload.sub, "7");
  assert.equal(payload.iss, "keel");
  assert.equal(payload.aud, "api");
  assert.equal(payload.exp! - payload.iat!, 3600);

  // Matching issuer/audience pass; mismatches are rejected.
  assert.ok(await jwt.verify(token, { issuer: "keel", audience: "api" }));
  assert.equal(await jwt.verify(token, { issuer: "other" }), null);
  assert.equal(await jwt.verify(token, { audience: "web" }), null);
});

test("jwt: rejects expired, tampered, wrong-secret, and non-HS256 tokens", async () => {
  await boot();

  // Expired: a negative lifetime puts exp in the past.
  const expired = await jwt.sign({ sub: "1" }, { expiresIn: -3600 });
  assert.equal(await jwt.verify(expired), null);

  // Tampered payload → signature mismatch.
  const good = await jwt.sign({ sub: "1" });
  const [h, , s] = good.split(".");
  const forgedBody = b64url({ sub: "999" });
  assert.equal(await jwt.verify(`${h}.${forgedBody}.${s}`), null);

  // Signed with a different secret → mismatch under the app key.
  const foreign = await jwt.sign({ sub: "1" }, { secret: "not-the-app-key" });
  assert.equal(await jwt.verify(foreign), null);
  assert.ok(await jwt.verify(foreign, { secret: "not-the-app-key" })); // ok with its own secret

  // alg:none forgery is refused outright (algorithm-confusion guard).
  const none = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "1" })}.`;
  assert.equal(await jwt.verify(none), null);

  // Structurally invalid strings never throw, just return null.
  assert.equal(await jwt.verify("not-a-jwt"), null);
  assert.equal(await jwt.verify(""), null);
});

async function build(configure: (r: Router) => void) {
  const app = await boot();
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("bearerAuth: 401 without token, resolves user with a valid token", async () => {
  setUserProvider((id) => ({ id, name: "Grace" }));
  const hono = await build((r) => {
    r.get("/me", async () =>
      json({ check: auth().check(), id: auth().id(), user: await auth().user() }),
    ).use(bearerAuth());
  });

  assert.equal((await hono.request("/me")).status, 401);
  assert.equal(
    (await hono.request("/me", { headers: { authorization: "Bearer garbage" } })).status,
    401,
  );

  const token = await jwt.sign({ sub: "99" });
  const res = await hono.request("/me", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    check: true,
    id: "99",
    user: { id: "99", name: "Grace" },
  });
});

test("bearerAuth({ optional: true }) passes through unauthenticated", async () => {
  const hono = await build((r) => {
    r.get("/maybe", () => json({ check: auth().check(), id: auth().id() })).use(
      bearerAuth({ optional: true }),
    );
  });

  const res = await hono.request("/maybe");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { check: false, id: null });
});
