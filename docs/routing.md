# Routing

Routes live in `routes/web.ts`. The default export receives the `Router` and
registers routes on it. The HTTP kernel later compiles them onto Hono.

```ts
import type { Router } from "@keel/core";
import { json, text, param } from "@keel/core";
import { HomeController } from "../app/Controllers/HomeController.js";

export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);          // controller
  router.get("/health", json({ status: "ok" }));        // static response
  router.get("/hi/:name", () => text(`Hi ${param("name")}`)); // dynamic
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

## Three kinds of handler

**Controller actions** — a `[Controller, method]` tuple, resolved from the
[container](./container.md) with dependency injection:

```ts
router.get("/users/:id", [UserController, "show"]);
```

**Static responses** — pass a ready-made response directly, no closure:

```ts
router.get("/health", json({ status: "ok" }));
router.get("/robots.txt", text("User-agent: *\nAllow: /"));
```

**Closures** — a function that runs per request. Use this whenever the response
depends on the request (route params, query, body), because those must be read
at request time:

```ts
router.get("/users/:id", () => json({ id: param("id") }));
```

> Rule of thumb: response is the same every time → pass it directly. Response
> depends on the request → wrap it in `() =>`.

## Reading the request

The `request` accessor (or the standalone shortcuts) read the current request —
no `c` needed:

```ts
request.param("id");            // route parameter
request.query("q");             // query string
request.header("authorization");
await request.json();           // parse a JSON body

// standalone equivalents
param("id");   query("q");   header("authorization");   await body();
```

`request` also exposes `request.method`, `request.path`, `request.url`,
`request.status`, and `request.raw` (the underlying web `Request`).

## Writing the response

Build responses with the standalone helpers or the `response` accessor — they're
the same thing:

```ts
json({ ok: true });                    // JSON response
text("hello");                          // plain text
html("<h1>Hi</h1>");                    // HTML
redirect("/login");                     // redirect

response.json({ ok: true });
response.status(201).json(created);     // set status, chainable
response.header("x-total", "42").json(rows);
```

Returning a **string** from a handler is shorthand — Keel wraps it as HTML.

## The full helper set

| Read (`request.*` or standalone) | Write (`response.*` or standalone) |
|----------------------------------|------------------------------------|
| `param(name)` · `query(name)` · `header(name)` | `json(data, status?)` · `text()` · `html()` |
| `body<T>()` (parse JSON body) | `redirect(location, status?)` |
| `request.method` · `.path` · `.status` · `.raw` | `response.status(code)` · `response.header(k, v)` |

All of these are powered by async-context storage the HTTP kernel enables for
every request, so they only work inside a request. You can always still take `c`
explicitly — both styles work.

## Inspecting routes

```bash
npm run keel routes
```

```
GET    /                        HomeController@index
GET    /health                  Static
GET    /users/:id               Closure
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
