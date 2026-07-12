import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

/**
 * These hit the real routes through the real kernel. A starter that ships no tests
 * teaches that tests are optional — and auth is the last place you want that.
 */
test("a visitor can register and reach the dashboard", async () => {
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
});

test("the dashboard turns guests away", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.get("/dashboard");

  assert.equal(response.status, 302, "a guest is redirected, not shown the page");
});

test("a wrong password says nothing about whether the account exists", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const response = await client.form("/login", {
    email: "nobody@example.com",
    password: "wrong",
  });

  assert.equal(response.status, 401);
});
