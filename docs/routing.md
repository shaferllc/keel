# Routing

Routes live in `routes/web.ts`. The default export receives the `Router` and
registers routes on it. The HTTP kernel later compiles them onto Hono.

```ts
import type { Router } from "@shaferllc/keel/core";
import { json, text, param } from "@shaferllc/keel/core";
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

## Named routes & URL generation

Name a route, then build its URL by name — no hardcoded paths:

```ts
router.get("/users/:id", [UserController, "show"]).name("users.show");

router.url("users.show", { id: 42 }); // "/users/42"
```

## Route groups

Share a prefix, middleware, and/or name prefix across many routes:

```ts
router
  .group(() => {
    router.get("/status", json({ up: true })).name("status");
    router.get("/me", [MeController, "show"]).name("me");
  })
  .prefix("/api")        // -> /api/status, /api/me
  .middleware([auth])    // runs before each route in the group
  .as("api");            // -> names "api.status", "api.me"
```

Groups nest — inner prefixes and middleware compose with the outer group's.

## Resource routes

Generate RESTful routes for a controller in one line:

```ts
router.resource("posts", PostController);
```

| Verb | Path | Action |
|------|------|--------|
| GET | `/posts` | `index` |
| GET | `/posts/create` | `create` |
| POST | `/posts` | `store` |
| GET | `/posts/:id` | `show` |
| GET | `/posts/:id/edit` | `edit` |
| PUT/PATCH | `/posts/:id` | `update` |
| DELETE | `/posts/:id` | `destroy` |

Trim the set with `.only([...])`, `.except([...])`, or `.apiOnly()` (drops the
HTML-form `create`/`edit` actions).

## Param constraints

Constrain a parameter with a regex, a matcher, or a `{ match }` object —
non-matching requests fall through to a 404:

```ts
router.get("/users/:id", [UserController, "show"]).where("id", /\d+/);

// built-in matchers
router.get("/u/:id", handler).where("id", router.matchers.number());
router.get("/a/:id", handler).where("id", router.matchers.uuid());
router.get("/s/:slug", handler).where("slug", router.matchers.slug());

// a global constraint applied to every matching :id
router.where("id", router.matchers.number());
```

Groups take constraints too: `group(...).where("id", router.matchers.uuid())`.

## Per-route middleware

```ts
router.get("/dashboard", [DashboardController, "index"]).middleware([auth]);
```

## Brisk routes: redirects, views & Inertia

`on()` is a shortcut for routes with no controller:

```ts
router.on("/old").redirect("/new");                 // path/URL redirect
router.on("/ext").redirectToPath("https://x.com");   // alias of redirect
router.on("/posts").redirectToRoute("articles.index", {}, { qs: { page: 1 } });

router.on("/about").render(AboutPage, { title: "About" }); // render a view
router.on("/dashboard").renderInertia("Dashboard", { user }); // Inertia page
```

See [Inertia](./inertia.md) for the full Inertia adapter.

## Domain & subdomain routing

Bind routes (or a group) to a host pattern. `:segments` capture subdomain
params, readable with `request.subdomain()`:

```ts
router
  .group(() => {
    router.get("/", () => json({ tenant: request.subdomain("tenant") }));
  })
  .domain(":tenant.example.com");

router.get("/", [BlogController, "index"]).domain("blog.example.com");
```

Requests are dispatched by their `Host` header; non-matching hosts fall through
to your default (undomained) routes.

## The current route

`request.route` exposes the matched route, and `request.routeIs()` checks it:

```ts
request.route;                 // { name, pattern, methods }
request.routeIs("posts.show"); // boolean
```

## More verbs

```ts
router.any("/webhook", [HookController, "handle"]);      // every verb
router.route(["GET", "POST"], "/search", handler);        // a specific set
```

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
