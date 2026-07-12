import { test } from "node:test";
import assert from "node:assert/strict";

import { testClient } from "@shaferllc/keel/core";
import { HttpKernel } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

/**
 * A starter that ships no tests teaches that tests are optional. This one hits the
 * real routes through the real kernel — no mocks, no server, no port.
 */
test("the API lists, creates, and fetches posts", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/health")).assertOk().assertJson({ ok: true });

  const created = await client.post("/posts", { title: "Hello", body: "First." });
  created.assertCreated();

  (await client.get("/posts")).assertOk();
});

test("a post that doesn't exist is a 404", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/posts/999999")).assertNotFound();
});
