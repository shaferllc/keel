import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpKernel, testClient, hash } from "@shaferllc/keel/core";

import { createApplication } from "../bootstrap/app.js";

/**
 * The REST API is generated straight from a TenantModel, so these tests really ask one
 * question: does the tenancy hold on a surface where nobody wrote a `where` clause?
 */

/** Register a user and return a client carrying their session. */
async function signUp(app: Awaited<ReturnType<typeof createApplication>>, name: string) {
  const client = testClient(app.make(HttpKernel));
  const registered = await client.form("/register", {
    name,
    email: `${name.toLowerCase()}+${crypto.randomUUID()}@example.com`,
    password: "correct horse battery",
  });

  return client.withCookies(registered.cookies());
}

test("the API refuses guests rather than leaking or crashing", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  // A guest has no team. Deny-by-default has to catch this *before* a tenant-scoped
  // query runs, or the request 500s on "no team in context" instead of 403ing.
  assert.equal((await client.get("/api/projects")).status, 403);
});

test("a signed-in user sees only their own team's projects", async () => {
  hash.fake();
  const app = await createApplication();

  const ada = await signUp(app, "Ada");

  const created = await ada.post("/api/projects", { name: "Ada's private project" });
  assert.equal(created.status, 201, "create returns 201");

  const adaList = await ada.get("/api/projects");
  adaList.assertOk();
  const adaBody = adaList.json<{ data: Array<{ id: number; name: string }> }>();
  assert.equal(adaBody.data.length, 1);
  assert.equal(adaBody.data[0]!.name, "Ada's private project");

  const adaProjectId = adaBody.data[0]!.id;

  // Grace, in her own personal team, must neither see it nor reach it.
  const grace = await signUp(app, "Grace");

  const graceList = await grace.get("/api/projects");
  graceList.assertOk();
  assert.equal(
    graceList.json<{ data: unknown[] }>().data.length,
    0,
    "Grace's list is empty — not Ada's",
  );

  // The one that matters: naming Ada's row by its id. Tenancy that only filters lists
  // isn't tenancy, so this has to 404 rather than 200.
  const stolen = await grace.get(`/api/projects/${adaProjectId}`);
  assert.equal(stolen.status, 404, "another team's project is not found, not fetched");

  hash.restore();
});

test("a create is stamped with the caller's team, not a team_id they supply", async () => {
  hash.fake();
  const app = await createApplication();

  const ada = await signUp(app, "Ada");

  // `team_id` isn't fillable and TenantModel stamps the current team on create, so a
  // forged team_id in the body is ignored rather than honored.
  const created = await ada.post("/api/projects", { name: "Forged", team_id: 999_999 });
  assert.equal(created.status, 201);

  const body = (await ada.get("/api/projects")).json<{ data: Array<{ team_id?: number }> }>();
  assert.notEqual(body.data[0]!.team_id, 999_999, "the forged team_id was not honored");

  hash.restore();
});

test("invalid input is a 422, not a 500", async () => {
  hash.fake();
  const app = await createApplication();

  const ada = await signUp(app, "Ada");

  assert.equal((await ada.post("/api/projects", { name: "" })).status, 422);

  hash.restore();
});

test("the OpenAPI spec documents the generated routes", async () => {
  const app = await createApplication();
  const client = testClient(app.make(HttpKernel));

  const spec = await client.get("/docs/openapi.json");
  spec.assertOk();

  const paths = spec.json<{ paths: Record<string, unknown> }>().paths;
  assert.ok(paths["/api/projects"], "the collection route is in the spec");
  assert.ok(paths["/api/projects/{id}"], "the item route is in the spec");
});
