import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { json } from "../src/core/request.js";
import { apiDoc } from "../src/openapi/doc.js";
import { buildSpec } from "../src/openapi/spec.js";
import { toJsonSchema } from "../src/openapi/zod.js";
import { OpenApiServiceProvider } from "../src/openapi/provider.js";
import type { OpenApiConfig } from "../src/openapi/config.js";

function cfg(over: Partial<OpenApiConfig> = {}): OpenApiConfig {
  return {
    enabled: true,
    path: "docs",
    title: "Test API",
    version: "2.0.0",
    servers: ["https://api.example.com"],
    public: false,
    cdn: "https://cdn.example.com",
    ignorePaths: [],
    ...over,
  };
}

const NewUser = z.object({ email: z.string().email(), age: z.number().min(18) });

function routerWithRoutes(): Router {
  const app = new Application();
  const r = app.make(Router);
  r.get("/users/:id", () => json({}))
    .where("id", /\d+/)
    .name("users.show")
    .config(apiDoc({ summary: "Get a user", tags: ["users"] }));
  r.post("/users", () => json({}))
    .name("users.store")
    .config(
      apiDoc({
        summary: "Create a user",
        tags: ["users"],
        request: { body: NewUser },
        responses: { 201: { description: "Created" } },
      }),
    );
  r.get("/search", () => json({})).config(
    apiDoc({ request: { query: z.object({ q: z.string(), page: z.number().optional() }) } }),
  );
  r.get("/secret", () => json({})).config(apiDoc({ hidden: true }));
  r.get("/docs/openapi.json", () => json({})); // the docs' own route
  return r;
}

test("buildSpec: paths, methods, path params, and info", () => {
  const spec = buildSpec(routerWithRoutes().all(), cfg(), "/docs");

  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.info.title, "Test API");
  assert.equal(spec.info.version, "2.0.0");
  assert.deepEqual(spec.servers, [{ url: "https://api.example.com" }]);

  // :id → {id}, and the `.where(/\d+/)` becomes a pattern on a required path param.
  const show = spec.paths["/users/{id}"]!.get as Record<string, unknown>;
  assert.equal(show.operationId, "users.show");
  assert.deepEqual(show.tags, ["users"]);
  const idParam = (show.parameters as Array<Record<string, unknown>>)[0]!;
  assert.equal(idParam.name, "id");
  assert.equal(idParam.in, "path");
  assert.equal(idParam.required, true);
  assert.equal((idParam.schema as Record<string, unknown>).pattern, "^\\d+$");
});

test("buildSpec: request body from a Zod schema, plus a 422", () => {
  const spec = buildSpec(routerWithRoutes().all(), cfg(), "/docs");
  const store = spec.paths["/users"]!.post as Record<string, unknown>;
  const body = store.requestBody as Record<string, any>;
  const schema = body.content["application/json"].schema;
  assert.deepEqual(schema.required, ["email", "age"]);
  assert.equal(schema.properties.email.format, "email");
  const responses = store.responses as Record<string, unknown>;
  assert.ok(responses["201"], "documented response present");
  assert.ok(responses["422"], "validation response inferred from request schema");
});

test("buildSpec: query schema expands into parameters", () => {
  const spec = buildSpec(routerWithRoutes().all(), cfg(), "/docs");
  const search = spec.paths["/search"]!.get as Record<string, unknown>;
  const params = search.parameters as Array<Record<string, unknown>>;
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.q!.in, "query");
  assert.equal(byName.q!.required, true);
  assert.equal(byName.page!.required, false);
});

test("buildSpec: hidden routes, the docs' own routes, and ignorePaths are excluded", () => {
  const spec = buildSpec(routerWithRoutes().all(), cfg({ ignorePaths: ["/search"] }), "/docs");
  assert.ok(!spec.paths["/secret"], "hidden route excluded");
  assert.ok(!spec.paths["/docs/openapi.json"], "docs' own route excluded");
  assert.ok(!spec.paths["/search"], "ignorePaths excluded");
  assert.ok(spec.paths["/users/{id}"], "normal routes still present");
});

test("toJsonSchema: converts Zod, passes JSON Schema through, ignores junk", () => {
  const converted = toJsonSchema(z.object({ name: z.string() }))!;
  assert.equal((converted.properties as any).name.type, "string");
  const passthrough = toJsonSchema({ type: "integer" })!;
  assert.equal(passthrough.type, "integer");
  assert.equal(toJsonSchema(42), undefined);
});

test("OpenApiServiceProvider: mounts /docs and /docs/openapi.json", async () => {
  const app = new Application();
  await app.boot([OpenApiServiceProvider], {
    discoverConfig: false,
    config: { openapi: { path: "docs" }, app: { name: "Demo", debug: true } },
  });
  const paths = app.make(Router).all().map((r) => r.path);
  assert.ok(paths.includes("/docs"), "UI route mounted");
  assert.ok(paths.includes("/docs/openapi.json"), "spec route mounted");
});
