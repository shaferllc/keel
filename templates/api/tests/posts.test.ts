import { test } from "node:test";
import assert from "node:assert/strict";

import { testClient, HttpKernel } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

/**
 * Hits the real routes through the real kernel — no mocks, no server, no port.
 */
test("the API lists, creates, and fetches posts", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/health")).assertOk().assertJson({ ok: true });

  const created = await client.post("/posts", { title: "Hello", body: "First." });
  created.assertCreated();
  const post = (created.json() as { data: { id: number; title: string } }).data;
  assert.equal(post.title, "Hello");

  const list = await client.get("/posts");
  list.assertOk();
  const body = list.json() as { data: unknown[]; meta: { total: number } };
  assert.ok(Array.isArray(body.data));
  assert.ok(body.meta.total >= 1);

  (await client.get(`/posts/${post.id}`)).assertOk();
});

test("a post that doesn't exist is a 404", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  (await client.get("/posts/999999")).assertNotFound();
});

test("OpenAPI documents the posts resource", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const spec = await client.get("/docs/openapi.json");
  spec.assertOk();
  const json = spec.json() as { paths: Record<string, unknown> };
  assert.ok(json.paths["/posts"], "list route is in the spec");
});
