# Built on Hono

Keel's HTTP layer **is** [Hono](https://hono.dev) — an ultrafast, web-standard
router that runs on Node, Cloudflare Workers, Deno, Bun, and more. Keel adds the
container, providers, routing sugar, and helpers on top; everything Hono can do
is available to you underneath.

Keel's convenience helpers (`json()`, `param()`, `request`, `response`, `view()`)
are thin wrappers over Hono's context. You never have to use them — you can
always take the context (`c`) directly and use the full Hono API.

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

Keel's `Ctx` type is exactly Hono's `Context`:

```ts
import type { Ctx } from "@shaferllc/keel/core";
```

Common context surface: `c.req.{param, query, header, json, parseBody, valid, path, method, url, raw}`,
`c.{json, text, html, body, redirect, status, header, notFound}`, `c.set/c.get`
for request-scoped variables, and on Workers `c.env` (bindings like D1/KV/R2) and
`c.executionCtx` (`waitUntil`). Full reference:
[hono.dev/docs/api/context](https://hono.dev/docs/api/context).

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

## Reaching the Hono app

The HTTP kernel compiles your routes onto a Hono instance and returns it —
that's the `fetch` handler you serve (Node) or export (Workers). If you need to
attach something at the Hono level, do it where you build the kernel:

```ts
const hono = new Kernel(app).build(); // a Hono instance
// hono.get(...), hono.use(...), export default hono, serve({ fetch: hono.fetch })
```

For anything HTTP-layer that Keel doesn't wrap yet, drop down to Hono — the docs
at [hono.dev](https://hono.dev/docs/) apply directly.
