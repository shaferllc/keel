import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient, hash } from "@shaferllc/keel/core";
import { totp } from "@shaferllc/keel/accounts";

import { createApplication } from "../bootstrap/app.js";
import { User } from "../app/Models/User.js";

/**
 * These hit the real routes through the real kernel. A starter that ships no tests
 * teaches that tests are optional — and auth is the last place you want that.
 */
test("a visitor can register and reach the dashboard", async () => {
  hash.fake();
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/login")).assertOk();

  const registered = await client.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });

  // A redirect to the dashboard means the session was set.
  assert.equal(registered.status, 302);
  hash.restore();
});

test("the dashboard turns guests away", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.get("/dashboard");

  assert.equal(response.status, 302, "a guest is redirected, not shown the page");
});

test("a wrong password says nothing about whether the account exists", async () => {
  hash.fake();
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.form("/login", {
    email: "nobody@example.com",
    password: "wrong",
  });

  assert.equal(response.status, 401);
  hash.restore();
});

test("the reset-password page accepts a token from the query string", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/reset-password?token=example-token")).assertOk();
});

test("enabling two-factor requires a confirmation code", async () => {
  hash.fake();
  const app = await createApplication();
  let client = testClient(app.make(HttpKernel));

  const email = `ada+${crypto.randomUUID()}@example.com`;
  const registered = await client.form("/register", {
    name: "Ada",
    email,
    password: "correct horse battery",
  });
  assert.equal(registered.status, 302);
  client = client.withCookies(registered.cookies());

  const setup = await client.form("/two-factor/enable", {});
  setup.assertOk();
  const html = await setup.text();
  assert.match(html, /Confirm and enable/);

  const secretMatch = html.match(/class="block break-all[^"]*"[^>]*>([A-Z2-7]+)</);
  assert.ok(secretMatch, "setup page shows the secret");
  const secret = secretMatch[1]!;

  const user = await User.query().where("email", email).first();
  assert.ok(user);

  const confirmed = await client.form("/two-factor/confirm", {
    code: await totp(secret),
  });
  assert.equal(confirmed.status, 302);

  hash.restore();
});
