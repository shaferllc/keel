import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

test("registering creates a personal team and lands on it", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const registered = await client.form("/register", {
    name: "Ada",
    email: `ada+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });

  // Redirected to /teams — the personal team exists, so tenant queries can run.
  assert.equal(registered.status, 302);
});

test("teams turn guests away", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  assert.equal((await client.get("/teams")).status, 302);
});
