# API Resources

`apiResource(router, Model, options)` generates a full CRUD REST API from a Keel
[model](./models.md) — explicit, server-side, and composed from pieces you already
have. It's imported
from `@shaferllc/keel/api`.

```ts
import { apiResource } from "@shaferllc/keel/api";
import { Post } from "../app/Models/Post.js";
import { z } from "zod";

export default function routes(router) {
  apiResource(router, Post, {
    filter: ["status", "authorId"],
    sort: ["createdAt", "title"],
    body: z.object({ title: z.string(), body: z.string(), status: z.string() }),
    access: { read: true, write: (c) => isEditor(c) },
  });
}
```

That registers five routes:

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/posts` | list (filtered, sorted, paginated) |
| `GET` | `/posts/:id` | read one |
| `POST` | `/posts` | create |
| `PUT` / `PATCH` | `/posts/:id` | update |
| `DELETE` | `/posts/:id` | delete |

They're real routes, so [`@shaferllc/keel/openapi`](./openapi.md) documents them
automatically, and writes go through the model's mass-assignment guard and your
Zod schema.

## Access is deny-by-default

An auto-generated API that's open by default is a footgun. Every action whose
access you don't declare returns **403**. You opt routes open — never shut.

```ts
access: {
  read: true,                    // list + read: anyone
  write: (c) => auth().check(),  // create + update + delete: signed-in only
}
```

Rules resolve per action: the action's own key (`list`, `get`, `create`,
`update`, `delete`), then the `read` / `write` shorthand, then `all`, then denied.
Each rule is a boolean or a `(c) => boolean | Promise<boolean>` predicate.

## Filtering, sorting, pagination — allow-listed

The list endpoint reads the query string, but **only** columns you allow-list:

- `filter: ["status"]` → `GET /posts?status=published` filters; `?secret=x` is
  ignored. Nothing reaches SQL unless it's on the list.
- `sort: ["title", "createdAt"]` → `GET /posts?sort=title,-createdAt` (a `-`
  prefix is descending); unknown columns are dropped.
- `GET /posts?page=2&perPage=20` paginates. `perPage` is clamped to `maxPerPage`
  (default 100) — the guard against "give me everything".

The response is a paginated envelope:

```json
{ "data": [ … ], "meta": { "total": 42, "perPage": 20, "currentPage": 2, "lastPage": 3 } }
```

## Row-level security with `scope`

`scope` constrains the base query for **every** row operation — list, read,
update, delete. A row outside the scope reads as 404, so it can't be fetched,
changed, or removed:

```ts
apiResource(router, Post, {
  access: { read: true, write: true },
  scope: (q, c) => q.where("authorId", currentUserId(c)), // only your own posts
});
```

## Shaping input and output

- **`body` / `createBody` / `updateBody`** — a Zod schema validating writes
  (a failure is a 422). It also becomes the request-body schema in the OpenAPI
  docs.
- **`beforeWrite(data, c, action)`** — mutate the write payload (stamp an owner
  id, a timestamp) before it's saved.
- **`transform`** — shape the output: a `(model, c) => …` function, or a Keel
  [Transformer](./transformers.md) (its `item`/`collection` are used).

## Options reference

| Option | Purpose |
|--------|---------|
| `path` | Base path (default: the model's table). |
| `name` | Route-name prefix (default: the path). |
| `only` / `except` | Restrict which of the five actions are generated. |
| `filter` / `sort` | Allow-listed columns for `?filter` and `?sort`. |
| `perPage` / `maxPerPage` | Page-size default and ceiling. |
| `body` / `createBody` / `updateBody` | Write validation schemas. |
| `access` | Per-action access rules (deny by default). |
| `scope` | Row-level query constraint for every operation. |
| `transform` | Output shaping. |
| `beforeWrite` | Mutate the payload before save. |
| `tags` | OpenAPI tags for the routes. |
| `label` | Singular name in doc summaries (default: the model's class name). |

Global pagination defaults live in `config/api.ts` (register the optional
`ApiServiceProvider`, then `keel vendor:publish --tag api-config`).

## What this isn't

There's no isomorphic frontend client here — no shared model object that runs on
both sides of the wire. Keel deliberately stops at the server boundary: this
generates a plain REST API you call however you like (fetch, your Inertia pages,
a mobile app). That keeps the model server-only and the wire contract explicit —
and it's exactly the contract the OpenAPI docs describe.
