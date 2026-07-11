# Built on Hono

Keel's HTTP layer **is** [Hono](https://hono.dev) — an ultrafast, web-standard
router that runs on Node, Cloudflare Workers, Deno, Bun, and more. Keel adds the
container, providers, routing sugar, and helpers on top; everything Hono can do
is available to you underneath.

Keel's convenience helpers (`json()`, `param()`, `request`, `response`, `view()`)
are thin wrappers over Hono's context. You never have to use them — you can
always take the context (`c`) directly and use the full Hono API.

## What Hono provides, what Keel adds

The division of labor is worth holding in your head, because it tells you which
docs to reach for:

| Concern | Owned by |
|---------|----------|
| The `fetch` handler, request matching, method routing | **Hono** |
| `Context` — `c.req`, `c.json`, `c.html`, cookies, headers | **Hono** |
| JSX rendering (`hono/jsx`), streaming, SSE, WebSockets | **Hono** |
| Runtime adapters (Node, Workers, Deno, Bun, Lambda) | **Hono** |
| The service container, providers, config, the console | **Keel** |
| Fluent routing: names, groups, resources, param matchers, URL generation | **Keel** ([routing](./routing.md)) |
| `[Controller, method]` handlers resolved from the container | **Keel** ([controllers](./controllers.md)) |
| Request/response helpers that reach `c` without threading it | **Keel** ([request & response](./request-response.md)) |
| `view()`, error rendering, exceptions, validation | **Keel** |

Hono is the engine; Keel is the wheelhouse. Keel never hides Hono — it sits
beside it. When Keel wraps a Hono feature it's for ergonomics (fluent routes,
container DI, ambient helpers), and the raw feature is always one `c` away.

## The context (`c`)

Every closure handler receives Hono's `Context`, and controller methods can too:

```ts
router.get("/users/:id", (c) => {
  c.req.param("id");          // route param
  c.req.query("q");           // query string
  c.req.header("authorization");
  await c.req.json();          // parse a JSON body

  return c.json({ ok: true }); // c.text() · c.html() · c.body() · c.redirect()
});
```

Keel's `Ctx` type is exactly Hono's `Context` — it's a re-export, not a wrapper:

```ts
import type { Ctx } from "@shaferllc/keel/core";
// type Ctx = import("hono").Context
```

So a Keel handler and a Hono handler have the identical signature. Anything that
accepts a Hono `Context` accepts a Keel `Ctx`, and vice versa — there is no
adapter, boxing, or conversion between the two. When a guide says "the request
context," it means this object.

Common context surface: `c.req.{param, query, header, json, parseBody, valid, path, method, url, raw}`,
`c.{json, text, html, body, redirect, status, header, notFound}`, `c.set/c.get`
for request-scoped variables, and on Workers `c.env` (bindings like D1/KV/R2) and
`c.executionCtx` (`waitUntil`). Full reference:
[hono.dev/docs/api/context](https://hono.dev/docs/api/context).

Keel does set a few request-scoped variables of its own on the context, which
you can read with `c.get(...)`:

- `c.get("app")` — the service container for this request.
- `c.get("route")` — the matched route (`{ name, pattern, methods }`).
- `c.get("subdomains")` — captured subdomain params on domain-bound routes.

These are exactly what the ambient [request helpers](./request-response.md) read
under the hood. That's the trade: the helpers are terse and don't need `c`
passed around, but they only work inside a request; `c` is explicit and works
anywhere you're handed it.

## Hono middleware works as-is

Any Hono middleware — built-in or third-party — drops straight into Keel's kernel
or onto a route, because Keel middleware **is** Hono middleware:

```ts
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { compress } from "hono/compress";

// app/Http/Kernel.ts
this.use(cors());
this.use(secureHeaders());
this.use(compress());
```

Hono ships CORS, Secure Headers, Body Limit, Cache, Compress, ETag, Basic/Bearer
Auth, JWT, Logger, and more — see
[hono.dev/docs/middleware/builtin](https://hono.dev/docs/middleware/builtin).
Keel just gives you nicer places to attach them: global in the kernel, or
per-route and per-group via the fluent router. [Middleware](./middleware.md)
covers the ordering and named-middleware conveniences Keel layers on top.

## What else you get from Hono

Because Keel is Hono underneath, these are all available directly:

| Hono feature | Use it in Keel |
|--------------|----------------|
| **JSX** | Keel [views](./views.md) are Hono JSX (`hono/jsx`) |
| **Cookies** | `hono/cookie`; Keel wraps common cases in `request.cookie` / `response.cookie` |
| **Streaming / SSE** | `hono/streaming` — return a streamed `Response` from a handler |
| **WebSockets** | Hono's upgrade helpers on supported runtimes |
| **Testing** | `hono.request(path, init)` — exactly what Keel's own test suite uses |
| **Validators / RPC** | `hono/validator`, the `hc` typed client |
| **Runtime adapters** | Node (`@hono/node-server`), Workers, Deno, Bun, Lambda |

[Views](./views.md) are the clearest example of Keel building on a Hono
primitive: a Keel view is a Hono JSX function component, and `view()` just
renders it to a full HTML document through the `View` service. Drop the helper
and `return c.html(<Page />)` and you get the same result — Keel's version only
adds the doctype and props typing.

## When to drop to raw Hono

Reach for `c` and the Hono API directly when:

- You need a context feature Keel doesn't wrap — `c.executionCtx.waitUntil`,
  streaming responses, content negotiation beyond the helpers, Workers bindings
  on `c.env`.
- You're pulling in a Hono (or Hono-ecosystem) middleware — it already speaks
  the native `Context`, so hand it `c` unchanged.
- You want the typed RPC client (`hc`) or `hono/validator`'s `c.req.valid(...)`.

Reach for Keel's helpers and fluent router when you want named routes, groups,
resource routes, container-resolved controllers, or the ambient
`request`/`response` accessors. The two mix freely in the same handler — start
with Keel's ergonomics and drop to `c` for the exact spot that needs it. Nothing
you do at the Hono level is "off the map"; it's the same object either way.

## Reaching the Hono app

The HTTP kernel compiles your routes onto a Hono instance and returns it —
that's the `fetch` handler you serve (Node) or export (Workers). If you need to
attach something at the Hono level, do it where you build the kernel:

```ts
const hono = new Kernel(app).build(); // a Hono instance
// hono.get(...), hono.use(...), export default hono, serve({ fetch: hono.fetch })
```

Because `build()` hands back a plain Hono app, the same kernel serves every
runtime — `serve({ fetch: hono.fetch })` under Node, `export default hono` on
Workers. That single return value is the seam that keeps Keel edge-portable (see
[Architecture](./architecture.md#edge-safe-by-design)).

For anything HTTP-layer that Keel doesn't wrap yet, drop down to Hono — the docs
at [hono.dev](https://hono.dev/docs/) apply directly.
