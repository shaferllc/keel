import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { auth, basicAuth } from "../src/core/auth.js";
import { hash } from "../src/core/crypto.js";
import { canFor, define, policy, gateAfter, gateBefore, clearAuthorization } from "../src/core/authorization.js";

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

function basic(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

test("basicAuth: challenges without creds, authenticates a returned id", async () => {
  const hono = await build((r) => {
    r.get("/admin", () => json({ id: auth().id() })).use(
      basicAuth((user, pass) => (user === "ada" && pass === "s3cret" ? 42 : false), { realm: "Admin" }),
    );
  });

  const anon = await hono.request("/admin");
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get("www-authenticate") ?? "", /Basic realm="Admin"/);

  const bad = await hono.request("/admin", { headers: { authorization: basic("ada", "wrong") } });
  assert.equal(bad.status, 401);

  const ok = await hono.request("/admin", { headers: { authorization: basic("ada", "s3cret") } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: "42" }); // verifier's id becomes auth().id()
});

test("basicAuth: a verifier returning true allows without an identity", async () => {
  const hono = await build((r) => {
    r.get("/gate", () => json({ id: auth().id() })).use(basicAuth(() => true));
  });
  const ok = await hono.request("/gate", { headers: { authorization: basic("x", "y") } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: null }); // allowed, but no user id set
});

test("hash.dummy is a valid hash that never verifies — for timing-safe login", async () => {
  // Verifying against the dummy runs the full PBKDF2 (no early-out) and returns false.
  assert.equal(await hash.verify(hash.dummy, "any password"), false);
  assert.equal(await hash.verify(hash.dummy, ""), false);
  // The documented pattern: user not found → compare against dummy, still false.
  const storedForMissingUser: string | undefined = undefined;
  assert.equal(await hash.verify(storedForMissingUser ?? hash.dummy, "guess"), false);
});

test("gateAfter overrides a decision; pairs with gateBefore", async () => {
  clearAuthorization();
  define("edit", (_user, ok) => Boolean(ok));

  // Base decision passes through untouched.
  assert.equal(await canFor({ id: 1 }, "edit", true), true);
  assert.equal(await canFor({ id: 1 }, "edit", false), false);

  // after-hook vetoes everything.
  gateAfter(() => false);
  assert.equal(await canFor({ id: 1 }, "edit", true), false);

  // after-hook returning undefined keeps the original result.
  clearAuthorization();
  define("edit", (_u, ok) => Boolean(ok));
  gateAfter(() => undefined);
  assert.equal(await canFor({ id: 1 }, "edit", true), true);

  // before-hook still short-circuits (admin bypass), after can still override.
  clearAuthorization();
  define("edit", () => false);
  gateBefore((user) => ((user as { admin?: boolean }).admin ? true : undefined));
  assert.equal(await canFor({ admin: true }, "edit"), true);
  assert.equal(await canFor({ admin: false }, "edit"), false);

  clearAuthorization();
});
