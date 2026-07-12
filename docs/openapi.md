# OpenAPI

Keel OpenAPI generates an [OpenAPI 3](https://spec.openapis.org/oas/v3.0.3) spec
from your routes and serves [Swagger UI](https://swagger.io/tools/swagger-ui/) to
explore it. It's a Keel [package](./packages.md): one `register()` mounts the docs
at `/docs` and the spec at `/docs/openapi.json`.

Nothing is scraped or guessed. The generator reads Keel's own route table —
methods, paths, names, and param constraints are always correct — and enriches
each operation with whatever the route attaches via `.config(apiDoc(...))`.

## Install

```ts
// bootstrap/providers.ts
import { OpenApiServiceProvider } from "@shaferllc/keel/openapi";

export const providers = [AppServiceProvider, OpenApiServiceProvider];
```

Open `http://localhost:3000/docs`. That's enough for a spec of every route (paths,
methods, path params). To add summaries, request/response schemas, and tags,
document the routes.

## Documenting a route

`apiDoc()` returns route config the generator understands. Its `request` field is
the same `{ body, query, params }` shape you hand `validateRequest`, so one set of
Zod schemas both validates and documents:

```ts
import { apiDoc } from "@shaferllc/keel/openapi";
import { validateRequest } from "@shaferllc/keel/core";
import { z } from "zod";

const NewUser = z.object({ email: z.string().email(), age: z.number().min(18) });

router
  .post("/users", [Users, "store"])
  .config(apiDoc({
    summary: "Create a user",
    tags: ["users"],
    request: { body: NewUser },
    responses: { 201: { description: "The created user", schema: UserShape } },
  }))
  .middleware([validateRequest({ body: NewUser })]);
```

What the generator does with it:

- **Path params** — `/users/:id` becomes `/users/{id}`; a `.where("id", /\d+/)`
  constraint becomes a `pattern`.
- **Query params** — a `request.query` schema's fields expand into query
  parameters (each `required` per the schema).
- **Request body** — a `request.body` schema becomes a JSON request body
  (Zod → JSON Schema via Zod 4's `z.toJSONSchema`).
- **Responses** — your documented responses, plus an automatic `422` when the
  route validates input. Undocumented routes get a default `200`.
- **Tags** — `tags`, or the first path segment.
- **operationId** — the route's `.name()`, else `method_path`.

Fields on `apiDoc`: `summary`, `description`, `tags`, `operationId`,
`deprecated`, `request`, `responses`, and `hidden` (leave the route out entirely).
Response and request schemas accept a Zod schema **or** a plain JSON Schema
object.

## Configuration

`config/openapi.ts` (publish with `keel vendor:publish --tag openapi-config`):

```ts
export default {
  enabled: true,
  path: "docs",                 // /docs and /docs/openapi.json
  title: "",                    // defaults to config("app.name")
  version: "1.0.0",
  servers: [],                  // e.g. ["https://api.example.com"]
  public: false,                // serve in production too
  cdn: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14",
  ignorePaths: ["/watch"],      // route prefixes to leave out
};
```

## Access

Like [Watch](./watch.md), the docs are gated shut in production by default (open
only when `app.debug` is on or the app isn't in production). Set `public: true` to
serve them everywhere, or plug in your own check:

```ts
import { OpenApi } from "@shaferllc/keel/openapi";
OpenApi.auth((c) => auth().check());
```

The gate guards the spec endpoint too.

## Exporting the spec

Write the spec to a file — for CI, client generation, or committing it:

```bash
keel openapi:export --out openapi.json
```

## On the UI dependency

The spec (`/docs/openapi.json`) is generated with **zero dependencies** and runs
anywhere Keel does, including the edge. The Swagger **UI** loads its assets from
the configured `cdn` — the one external dependency, confined to the browser. Pin
the version (the default is pinned) or point `cdn` at a copy you host if you need
a fully self-contained deployment.
