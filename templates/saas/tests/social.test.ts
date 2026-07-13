import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient } from "@shaferllc/keel/core";

// Set before the app boots: config/*.ts is loaded (and cached) on the first
// `createApplication()`, so this is the only window in which a provider can be turned
// on. That's also why the *unconfigured* behaviour lives in its own file — each test
// file gets a fresh process, and therefore a fresh config.
process.env.GITHUB_CLIENT_ID = "test-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-client-secret";

const { createApplication } = await import("../bootstrap/app.js");

test("a configured provider is offered on the login page", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const page = await client.get("/login");
  page.assertOk();

  const html = page.text();
  assert.match(html, /Continue with GitHub/);
  assert.match(html, /href="\/auth\/github"/);

  // Google has no credentials, so it must not be offered even though the driver exists.
  assert.doesNotMatch(html, /Continue with Google/);
});

test("the redirect sends the user to GitHub with a state parameter", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.get("/auth/github");

  assert.equal(response.status, 302);

  const location = response.header("location") ?? "";
  assert.match(location, /^https:\/\/github\.com\/login\/oauth\/authorize/);
  assert.match(location, /client_id=test-client-id/);

  // The state is the CSRF defence: without it, an attacker hands you a callback URL
  // bearing their code and you are quietly signed in as them.
  assert.match(location, /state=/);
});

test("a callback whose state doesn't match is refused", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.get("/auth/github/callback?code=abc&state=not-the-one-we-issued");

  assert.equal(response.status, 403);
});

test("a callback with no state at all is refused", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  // The guard that's easy to leave out: with no session state *and* no query state,
  // `undefined === undefined` would pass and the handshake would proceed unprotected.
  const response = await client.get("/auth/github/callback?code=abc");

  assert.equal(response.status, 403);
});

test("an unknown provider is refused", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  assert.equal((await client.get("/auth/myspace")).status, 403);
});
