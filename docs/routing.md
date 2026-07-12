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

Building URLs from names — plain and tamper-proof signed URLs — is its own
topic. See the [URL builder](./url-builder.md) for `router.url()`,
`router.signedUrl()`, and `router.hasValidSignature()`.

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

## Route config

Attach arbitrary metadata to a route (or a whole group) with `.config()`, then
read it in the handler or route middleware via `request.route.config` — for
per-route flags like an auth scope, a rate tier, or a layout choice:

```ts
router.get("/admin", [Admin, "index"]).config({ scope: "admin", rateTier: "high" });

router
  .group(() => {
    router.get("/billing", [Billing, "index"]); // inherits { area: "billing" }
    router.get("/billing/export", [Billing, "export"]).config({ heavy: true });
  })
  .config({ area: "billing" }); // a route's own config wins on conflict
```

```ts
// in a guard middleware attached to the route/group:
if (request.route?.config.scope === "admin") await authorize("access-admin");
```

Group config is merged into every route in the group, with a route's own keys
winning. Route config is available to **route/group middleware** and the handler
(not global middleware, which runs before route matching).

## The current route

`request.route` exposes the matched route, and `request.routeIs()` checks it:

```ts
request.route;                 // { name, pattern, methods, config }
request.routeIs("posts.show"); // boolean
```

## More verbs

```ts
router.any("/webhook", [HookController, "handle"]);      // every verb
router.route(["GET", "POST"], "/search", handler);        // a specific set
```

## Route model binding

A `:post` in the path can arrive as a **`Post`**, not a string:

```ts
import { bindModel, boundModel } from "@shaferllc/keel/core";

bindModel("post", Post); // once, in a provider

router.get("/posts/:post", (c) => {
  const post = boundModel(Post); // already fetched. Not a string, not null.
  return c.json(post);
});
```

The row is looked up **before your handler runs**, and a miss is a 404 there and
then. That's the whole value: the handler never sees a `null`, so it never has to
remember to check for one — **"forgot the 404" stops being a bug you can write.**

Compare what you'd otherwise type in every handler:

```ts
router.get("/posts/:id", async (c) => {
  const post = await Post.find(c.req.param("id"));
  if (!post) throw new NotFoundException(); // ...every time, forever
  return c.json(post);
});
```

### By another column

When the URL isn't the id:

```ts
bindModel("post", Post, { key: "slug" }); // /posts/hello-world
```

### `scope` — this is security, not a filter

```ts
bindModel("post", Post, {
  scope: (query, c) => query.where("authorId", currentUserId(c)),
});
```

A row outside the scope is a **404**, not a 403 and not a filtered list — so it
cannot be reached by *guessing its id*. That's the difference between row-level
security and decoration. `/posts/2` doesn't 403 (which would confirm the row
exists); it simply isn't there.

The scope gets the request, so it can depend on who's asking.

### Middleware sees the model

Binding runs **before** route middleware, so a policy can read the model rather
than re-fetching it:

```ts
const mustOwn: MiddlewareHandler = async (c, next) => {
  if (boundModel(Post).authorId !== currentUserId(c)) throw new ForbiddenException();
  await next();
};

router.get("/posts/:post/edit", edit).middleware(mustOwn);
```

### Anything that isn't a model

```ts
bindRoute("tenant", (slug) => tenants.get(slug)); // undefined ⇒ 404

router.get("/t/:tenant", () => {
  const tenant = boundValue<Tenant>("tenant");
});
```

### Notes

- An **unbound** param is untouched — still just a string via `c.req.param()`.
- Two params bound to the same model? Say which: `boundModel(Post, "original")`.
  Guessing would be worse than asking.
- `missing()` substitutes a value instead of 404ing, if you'd rather.
- Only routes with parameters pay for any of this.

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

---

## API reference

Registration methods live on `Router`. Each verb method hands back a `Route` you
chain to name, guard, or constrain it; `group()`, `resource()`, and `on()` hand
back `RouteGroup`, `RouteResource`, and a brisk-route matcher respectively. You
never construct these classes — the framework builds the `Router` and passes it
to your routes file, and the rest come back from its methods.

URL generation (`url`, `signedUrl`, `hasValidSignature`) also lives on `Router`
but is documented separately in the [URL builder](./url-builder.md).

### `matchers`

`matchers: { number(): RegExp; uuid(): RegExp; slug(): RegExp; alpha(): RegExp }`

The built-in parameter matchers, also reachable as `router.matchers`. Each
returns a fresh (un-anchored) `RegExp` to hand to `.where()`.

```ts
import { matchers } from "@shaferllc/keel/core";

router.get("/u/:id", handler).where("id", matchers.number());
```

**Notes:** `number` → `\d+`, `uuid` → a canonical UUID, `slug` →
`a-z0-9` words joined by `-`, `alpha` → letters only. They are plain regexes, so
you can also pass your own `/.../ ` or a `{ match }` object.

### Router

The route registrar. Injected into your routes file; resolve it elsewhere with
`app.make(Router)`.

#### `get(path, handler)` · `post` · `put` · `patch` · `delete`

`get(path: string, handler: RouteHandler): Route`

Registers a route for the one HTTP verb and returns the `Route` for chaining.

```ts
router.get("/users/:id", [UserController, "show"]);
router.post("/users", [UserController, "store"]);
router.delete("/users/:id", [UserController, "destroy"]);
```

**Notes:** `post`, `put`, `patch`, and `delete` share the identical signature.
`handler` is a closure, a `[Controller, "method"]` tuple, or a ready-made
`Response` — see [`RouteHandler`](#routehandler). Paths are normalized (a
trailing slash is trimmed; `"/"` stays `"/"`).

#### `any(path, handler)`

`any(path: string, handler: RouteHandler): Route`

Registers the route for every HTTP verb (`GET POST PUT PATCH DELETE OPTIONS HEAD`).

```ts
router.any("/webhook", [HookController, "handle"]);
```

#### `route(methods, path, handler)`

`route(methods: Method[], path: string, handler: RouteHandler): Route`

Registers the route for a specific set of verbs.

```ts
router.route(["GET", "POST"], "/search", handler);
```

**Notes:** `Method` is the uppercase verb union — pass them exactly (`"GET"`, not
`"get"`).

#### `on(path)`

`on(path: string): RouteMatcher`

Opens a brisk-route matcher for controller-less routes (redirects, views,
Inertia pages). See [`RouteMatcher`](#routematcher).

```ts
router.on("/old").redirect("/new");
router.on("/about").render(AboutPage, { title: "About" });
```

#### `group(callback)`

`group(callback: () => void): RouteGroup`

Runs `callback` (which registers routes on the router) and returns a
[`RouteGroup`](#routegroup) wrapping exactly the routes it added, so you can
apply a shared prefix / middleware / name prefix to them.

```ts
router
  .group(() => {
    router.get("/status", json({ up: true })).name("status");
    router.get("/me", [MeController, "show"]).name("me");
  })
  .prefix("/api")
  .middleware([auth])
  .as("api");
```

**Notes:** the grouping (prefix, middleware, name prefix) is applied *after*
registration by the returned `RouteGroup` — the callback itself sees no prefix.
Nest by calling `.prefix()` on the inner group before the outer group's; the
outer prefix is prepended, so `/api` + `/v1/...` composes correctly.

#### `resource(name, controller)`

`resource(name: string, controller: ControllerRef): RouteResource`

Registers the seven RESTful routes (`index create store show edit update
destroy`) for `controller` and returns a [`RouteResource`](#routeresource) to
trim or rename them.

```ts
router.resource("posts", PostController);
router.resource("posts.comments", CommentController); // nested
```

**Notes:** each route is auto-named `${name}.${action}`. A dotted `name` nests
resources — `"posts.comments"` yields `/posts/:post_id/comments/:id`. The
controller may be a class or a lazy `() => import(...)` loader.

#### `where(param, matcher)`

`where(param: string, matcher: Matcher): this`

Registers a **global** parameter constraint, applied at `all()` time to every
route whose path contains `:param` and that doesn't already constrain it.

```ts
router.where("id", matchers.number());
```

**Notes:** per-route and group `.where()` win over a global one. Returns the
router for chaining.

#### `named(map)`

`named(map: Record<string, MiddlewareHandler>): this`

Registers named middleware you can later reference by string in `.middleware()`
/ `.use()`.

```ts
router.named({ auth, admin });
router.get("/panel", handler).use("auth");
```

**Notes:** merges into any previously named middleware. Referencing an
unregistered name throws at resolve time (see `resolveMiddleware`).

#### `resolveMiddleware(ref)`

`resolveMiddleware(ref: MiddlewareRef): MiddlewareHandler`

Resolves a middleware reference — a handler passes through; a string is looked up
in the `named()` registry.

```ts
const mw = router.resolveMiddleware("auth");
```

**Notes:** throws `No named middleware [name]…` if a string isn't registered.
Mostly used by the HTTP kernel; handy in tests.

#### `all()`

`all(): RouteDefinition[]`

Returns every live route definition, after folding in global `where()`
constraints and dropping routes trimmed to zero methods (by `only`/`except`).

```ts
for (const r of router.all()) console.log(r.methods, r.path, r.name);
```

**Notes:** this is the list the HTTP kernel compiles onto Hono. Trimmed resource
actions are excluded here, but `url()` can still find them by name.

#### `resolve(handler)`

`resolve(handler: RouteHandler): HandlerFn`

Turns a `RouteHandler` into a callable `(c: Ctx) => …`, resolving controller
tuples through the container and lazy loaders.

```ts
const fn = router.resolve([UserController, "show"]);
```

**Notes:** a bare `[Controller]` tuple calls the controller's `handle` method. A
`Response` handler is cloned per call. Throws if the named controller method
doesn't exist. Called by the kernel; you rarely call it directly.

### Route

Returned by every verb method (`get`/`post`/…). Chain to name, guard, or
constrain a single route. Exposes a readonly `def: RouteDefinition`.

#### `name(name)` · `as(name)`

`name(name: string): this`

Names the route for URL generation. `as()` is an alias.

```ts
router.get("/users/:id", handler).name("users.show");
router.get("/users/:id", handler).as("users.show");
```

#### `middleware(mw)` · `use(mw)`

`middleware(mw: MiddlewareRef | MiddlewareRef[]): this`

Attaches middleware that runs only for this route, after any group middleware.
`use()` is an alias.

```ts
router.get("/dashboard", handler).middleware([auth]);
router.get("/admin", handler).use(["auth", "admin"]);
```

**Notes:** accepts a single ref or an array; appends (order preserved). A string
ref is resolved against `named()`.

#### `where(param, matcher)`

`where(param: string, matcher: Matcher): this`

Constrains a route parameter; non-matching requests fall through to a 404.

```ts
router.get("/users/:id", handler).where("id", /\d+/);
```

#### `domain(pattern)`

`domain(pattern: string): this`

Binds the route to a host pattern; `:segments` capture subdomain params.

```ts
router.get("/", [BlogController, "index"]).domain("blog.example.com");
```

### RouteGroup

Returned by `group()`. Its fluent methods apply across every route the group
callback registered. All return `this`.

#### `prefix(prefix)`

`prefix(prefix: string): this`

Prepends a path prefix to every route in the group.

```ts
router.group(() => { /* … */ }).prefix("/api");
```

**Notes:** leading/trailing slashes are normalized. Applying to the group's root
route (`"/"`) yields just the prefix.

#### `middleware(mw)` · `use(mw)`

`middleware(mw: MiddlewareRef | MiddlewareRef[]): this`

Prepends middleware to every route in the group, so group middleware runs before
each route's own. `use()` is an alias.

```ts
router.group(() => { /* … */ }).middleware([auth]);
```

#### `where(param, matcher)`

`where(param: string, matcher: Matcher): this`

Constrains a parameter across the group, skipping routes that already constrain
it themselves.

```ts
router.group(() => { /* … */ }).where("id", matchers.uuid());
```

#### `as(namePrefix)`

`as(namePrefix: string): this`

Prefixes the name of every *already-named* route in the group.

```ts
router.group(() => { /* named routes */ }).as("api"); // status -> api.status
```

**Notes:** routes without a `name()` are left untouched — name them inside the
callback for `as()` to reach them.

#### `domain(pattern)`

`domain(pattern: string): this`

Binds every route in the group to a host pattern.

```ts
router.group(() => { /* … */ }).domain(":tenant.example.com");
```

### RouteResource

Returned by `resource()`. Chain to trim, rename, or guard the generated actions.
All return `this`.

#### `only(actions)` · `except(actions)`

`only(actions: string[]): this`
`except(actions: string[]): this`

Keep only the listed actions, or drop the listed actions.

```ts
router.resource("posts", PostController).only(["index", "show"]);
router.resource("posts", PostController).except(["destroy"]);
```

**Notes:** trimming empties a route's `methods`; `all()` then filters it out. The
route name still exists, so `url()` can resolve it even when it won't be served.

#### `apiOnly()`

`apiOnly(): this`

Drops the HTML-form actions (`create`, `edit`) — the shorthand for
`.except(["create", "edit"])`.

```ts
router.resource("posts", PostController).apiOnly();
```

#### `as(name)`

`as(name: string): this`

Renames the route-name prefix for every action.

```ts
router.resource("posts", PostController).as("articles"); // articles.index, …
```

#### `params(map)`

`params(map: Record<string, string>): this`

Renames route parameters. Maps a resource segment to a new param name.

```ts
router.resource("posts", PostController).params({ posts: "post" }); // :id -> :post
```

**Notes:** for the resource's own segment the underlying param is `:id`; for a
parent segment in a nested resource it's `:{singular}_id`. Only the first
matching occurrence in each path is renamed.

#### `use(actions, mw)`

`use(actions: string[] | "*", mw: MiddlewareRef | MiddlewareRef[]): this`

Attaches middleware to specific actions, or to all with `"*"`.

```ts
router.resource("posts", PostController)
  .use(["store", "update", "destroy"], "auth")
  .use("*", logRequests);
```

### RouteMatcher

Returned by `router.on(path)` — a builder for controller-less `GET` routes. Each
method registers the route and returns the underlying `Route`.

#### `redirect(to, status?)` · `redirectToPath(to, status?)`

`redirect(to: string, status?: number): Route`

Registers a route that redirects to a path or URL (default status `302`).
`redirectToPath` is an alias.

```ts
router.on("/old").redirect("/new");
router.on("/ext").redirectToPath("https://example.com", 301);
```

#### `redirectToRoute(name, params?, options?)`

`redirectToRoute(name: string, params?: Record<string, string | number>, options?: { qs?: Record<string, string | number>; status?: number }): Route`

Registers a route that redirects to a named route, resolving its URL (and
optional query string).

```ts
router.on("/posts").redirectToRoute("articles.index", {}, { qs: { page: 1 } });
```

#### `render(component, props?)`

`render(component: (props?: any) => unknown, props?: any): Route`

Registers a route that renders a view component directly.

```ts
router.on("/about").render(AboutPage, { title: "About" });
```

#### `renderInertia(component, props?)`

`renderInertia(component: string, props?: Record<string, unknown>): Route`

Registers a route that renders an Inertia page component by name. See
[Inertia](./inertia.md).

```ts
router.on("/dashboard").renderInertia("Dashboard", { user });
```

### Interfaces & types

#### `Ctx`

`type Ctx = Context` (Hono's request context)

The context handed to every handler and middleware. Every closure handler
receives it, though the `request`/`response` accessors mean you rarely read from
it directly.

```ts
router.get("/", (c: Ctx) => c.text("hi"));
```

#### `RouteHandler`

`type RouteHandler = HandlerFn | ControllerAction | Response`

What you pass as the second argument to a verb method. One of three shapes:

- **`HandlerFn`** — `(c: Ctx) => Response | string | Promise<Response | string>`;
  returning a bare string is wrapped as HTML.
- **`ControllerAction`** — `[Controller]` (calls `handle`) or
  `[Controller, "method"]`; the controller may be a lazy `() => import(...)`.
- **`Response`** — a ready-made response, cloned per request.

```ts
router.get("/a", (c) => c.json({ ok: true })); // HandlerFn
router.get("/b", [UserController, "show"]);      // ControllerAction
router.get("/c", json({ up: true }));            // Response
```

#### `Matcher`

`type Matcher = RegExp | string | { match: RegExp }`

A route-parameter constraint accepted by `.where()`. A regex, a regex-source
string, or a `{ match }` wrapper (the shape the built-in `matchers` conform to).

```ts
const a: Matcher = /\d+/;
const b: Matcher = "\\d+";
const c: Matcher = { match: /[a-z]+/ };
```

#### `Method`

`type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD"`

The HTTP verbs. Passed to `route()`; also the type of `RouteDefinition.methods`.

```ts
router.route(["GET", "POST"] as Method[], "/search", handler);
```

#### `MiddlewareRef`

`type MiddlewareRef = MiddlewareHandler | string`

A middleware handler, or the name of one registered with `router.named()`.
Accepted by every `.middleware()` / `.use()`.

```ts
router.get("/a", handler).use("auth");         // named
router.get("/b", handler).use(rateLimiterMw);  // handler
```

#### `RouteDefinition`

```ts
interface RouteDefinition {
  methods: Method[];
  path: string;
  handler: RouteHandler;
  name?: string;
  middleware: MiddlewareRef[];
  wheres: Record<string, string>;
  domain?: string;
}
```

The compiled record for one route — what `all()` returns and the kernel reads.
You inspect these (e.g. to print a route table); you don't build them by hand.
`wheres` holds each param's regex *source* string, keyed by param name.

```ts
for (const def of router.all()) {
  console.log(def.methods.join("|"), def.path, def.name ?? "");
}
```

> `UrlOptions` and `SignedUrlOptions` are exported from this module too, but they
> belong to URL generation — see the [URL builder](./url-builder.md).
