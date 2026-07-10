# Routing

Routes live in `routes/web.ts`. The default export receives the `Router` and
registers routes on it. The HTTP kernel later compiles them onto Hono.

```ts
import type { Router, Ctx } from "@keel/core";
import { HomeController } from "../app/Controllers/HomeController.js";

export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);
  router.get("/ping", (c) => c.json({ pong: true }));
}
```

## HTTP verbs

```ts
router.get(path, handler);
router.post(path, handler);
router.put(path, handler);
router.patch(path, handler);
router.delete(path, handler);
```

Each returns the router, so calls chain.

## Two kinds of handler

**Closures** — inline functions that receive the request context:

```ts
router.get("/health", (c) => c.json({ status: "ok" }));
```

**Controller actions** — a `[Controller, method]` tuple. Keel resolves the
controller out of the [container](./container.md), so it gets dependency
injection:

```ts
router.get("/users/:id", [UserController, "show"]);
```

## Route parameters

Parameters use Hono's `:name` syntax and are read from the context:

```ts
router.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
router.get("/posts/:year/:slug", (c) => {
  const { year, slug } = c.req.param();
  return c.json({ year, slug });
});
```

## The context (`Ctx`)

`Ctx` is Hono's request/response context. Common helpers:

```ts
c.req.param("id");            // route parameter
c.req.query("q");             // query string
c.req.header("authorization");
await c.req.json();           // parse a JSON body

c.json({ ok: true });         // JSON response
c.text("hello");              // plain text
c.html("<h1>Hi</h1>");        // HTML
c.redirect("/login");         // redirect
c.status(201);                // set status
```

Returning a **string** from a handler is shorthand — Keel wraps it as HTML.

Full context API: [hono.dev/docs/api/context](https://hono.dev/docs/api/context).

## Request & response helpers

You don't have to thread the context (`c`) through everything. Global request
helpers reach the current request for you, so handlers stay terse:

```ts
import { json, text, param, query, body, redirect } from "@keel/core";

// instead of:  show(c: Ctx) { return c.json({ id: c.req.param("id") }); }
show() {
  return json({ id: param("id") });
}

async store() {
  const data = await body<{ email: string }>();
  return json({ created: data.email }, 201);
}

search() {
  return text(`Searching for ${query("q")}`);
}
```

| Helper | Returns |
|--------|---------|
| `json(data, status?)` | JSON `Response` |
| `text(body, status?)` / `html(body, status?)` | text / HTML `Response` |
| `redirect(location, status?)` | redirect `Response` |
| `param(name)` / `param()` | one route param / all of them |
| `query(name)` / `query()` | one query value / all of them |
| `header(name)` | a request header |
| `body<T>()` | the parsed JSON body (async) |
| `request()` / `ctx()` | the raw `Request` / the Hono context |

These are powered by async-context storage that the HTTP kernel enables for every
request, so they only work inside a request. You can always still take `c`
explicitly — both styles work.

## Inspecting routes

```bash
npm run keel routes
```

```
GET    /                        HomeController@index
GET    /users/:id               HomeController@show
GET    /ping                    Closure
```

## Adding more route files

`bootstrap/app.ts` loads `routes/web.ts`. To split routes (e.g. an `api.ts`),
import and call it there:

```ts
import registerWebRoutes from "../routes/web.js";
import registerApiRoutes from "../routes/api.js";

registerWebRoutes(app.make(Router));
registerApiRoutes(app.make(Router));
```
