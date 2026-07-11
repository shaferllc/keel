# Middleware

Middleware wraps every request, running code before and after your route
handler. Keel uses Hono's middleware signature, so a middleware is just an async
function of `(c, next)` — the same shape you'd write for a bare Hono app.

There are two ways a middleware runs: **globally**, on every request (registered
in the HTTP kernel), or **per route/group**, attached where you declare the
route. Global middleware is for cross-cutting concerns (logging, CORS, request
IDs); route middleware is for guards that only some routes need (auth, admin).

## The HTTP kernel

Global middleware is registered in `app/Http/Kernel.ts`, which extends the
framework's `HttpKernel`:

```ts
import { HttpKernel, Application } from "@shaferllc/keel/core";
import { requestLogger } from "./Middleware/requestLogger.js";

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger);   // runs on every request, in order
  }
}
```

Call `this.use(...)` once per middleware. They run in the order added. The kernel
wires a few internal middleware first — context storage and container binding —
so by the time your global middleware runs, `c.get("app")` (the container) is
already set. Stack several by chaining or calling `use` repeatedly:

```ts
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger).use(cors).use(requestId);
  }
}
```

The kernel also compiles the router's routes onto a Hono instance (`build()`,
called by `keel serve` — you never call it yourself) and turns thrown exceptions
and unmatched routes into responses. To replace that default rendering, register
a custom error handler:

```ts
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger);
    this.onError((err, c) => c.json({ oops: String(err) }, 500));
  }
}
```

See [errors](./errors.md) for what the default handler does and how reportable
exceptions hook in.

## Writing middleware

A middleware is an async function of `(c, next)`. Do work, `await next()` to
pass control down the stack, then optionally do work on the way back up:

```ts
import type { MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();                                   // run the rest of the stack
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
};
```

`c` is Hono's `Context` (Keel re-exports it as [`Ctx`](./routing.md)); `next`
advances to the next middleware, and eventually the route handler. Everything
before `await next()` runs on the way in; everything after runs on the way out,
in reverse order. Skip `next()` entirely to short-circuit (see below).

Generate a stub with:

```bash
npm run keel make:middleware Auth
# -> app/Http/Middleware/authMiddleware.ts
```

The generator strips a trailing `Middleware` from the name, PascalCases it, then
lower-cases the first letter for the filename and the exported const — so
`make:middleware Auth` writes `authMiddleware.ts` exporting `authMiddleware`, and
`make:middleware RateLimit` writes `rateLimitMiddleware.ts`. The stub is a ready
`MiddlewareHandler` with `before`/`after` markers around `await next()`.

## Named middleware

Register middleware by name once, then reference it by name on routes and groups
— no importing the function everywhere:

```ts
// routes/web.ts (or a service provider) — anywhere you hold the router.
router.named({
  auth: authMiddleware,
  admin: adminMiddleware,
});

router.get("/dashboard", [DashboardController, "index"]).use("auth");
router.group(() => { /* … */ }).use(["auth", "admin"]);
router.resource("posts", PostController).use(["store", "update"], "auth");
```

`router.named()` takes a map of names to **handlers** (functions, not other
names), and merges into any previously registered names — call it as many times
as you like. The `Router` is a singleton, so names registered on the instance
passed to your route file are the same ones the kernel resolves at build time.

You can still pass raw functions anywhere a name is accepted — the `.use()` /
`.middleware()` argument is a `MiddlewareRef` (`MiddlewareHandler | string`), so
you mix and match:

```ts
router.get("/reports", [ReportController, "index"]).use(["auth", auditLog]);
```

Referencing an unregistered name throws when the app builds —
`No named middleware [auth]. Register it with router.named({ auth: … }).` — so
typos surface immediately at boot, not on the first matching request.

For **parameterized** middleware, use a factory that returns a handler:

```ts
const role = (name: string): MiddlewareHandler => async (c, next) => {
  // check role === name …
  await next();
};

router.get("/admin", handler).use(role("admin"));
```

You can register the *result* of a factory as a name, too, if a fixed
configuration recurs:

```ts
router.named({ admin: role("admin"), editor: role("editor") });
router.get("/admin", handler).use("admin");
```

## Short-circuiting

Return a response _without_ calling `next()` to stop the request early — handy
for auth guards:

```ts
export const requireApiKey: MiddlewareHandler = async (c, next) => {
  if (c.req.header("x-api-key") !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
```

Because the handler and every inner middleware never run, short-circuiting is how
guards enforce access. You can also `throw` an [HTTP exception](./errors.md)
instead of returning — the kernel's error handler renders it:

```ts
import { UnauthorizedException } from "@shaferllc/keel/core";

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!c.get("app").make(Auth).check()) throw new UnauthorizedException();
  await next();
};
```

## Sharing data with handlers

Stash values on the context; downstream handlers read them back. Keel already
does this to expose the container as `c.get("app")`:

```ts
export const withUser: MiddlewareHandler = async (c, next) => {
  c.set("user", await lookupUser(c.req.header("authorization")));
  await next();
};

// later, in a handler:
const user = c.get("user");
```

To get type safety on custom context variables, augment Hono's
`ContextVariableMap` (see [`src/core/hono.d.ts`](../src/core/hono.d.ts) for how
Keel does it for `app`, `route`, `subdomains`, and `session`):

```ts
declare module "hono" {
  interface ContextVariableMap {
    user?: { id: number; name: string };
  }
}
```

With that in place `c.set("user", …)` and `c.get("user")` are fully typed
everywhere.

## Order of execution

```
requestLogger  ┐            ┌  requestLogger
               ▼            │
requireApiKey ─┼─► handler ─┘
```

Middleware added first is outermost: it runs first on the way in and last on the
way out. The full order for any request is:

1. Keel's internal middleware (context storage, container/subdomain binding).
2. Global middleware, in the order you `use()`d them in the kernel.
3. Group middleware, outermost group first.
4. Per-route middleware, in the order attached.
5. The route handler.

Group middleware always runs *before* the route's own middleware — a group
prepends its middleware to each contained route. So this:

```ts
router.group(() => {
  router.get("/posts/:id/edit", handler).use("owns-post");
}).use("auth");
```

runs `auth` (group), then `owns-post` (route), then `handler` — a natural
"authenticated, *and* owns this post" gate.

## Related

Attaching middleware to routes, groups, and resources is part of the
[routing](./routing.md) API — this page covers writing and registering the
handlers; routing covers where they hang.

---

## API reference

### `HttpKernel`

The base class your `app/Http/Kernel.ts` extends. It owns the global middleware
stack, compiles routes onto Hono, and renders errors. You construct your subclass
(the bootstrap does, via `app.singleton(HttpKernel, …)`); you don't construct
`HttpKernel` directly.

#### `use(mw)`

`use(mw: MiddlewareHandler): this`

Appends a middleware to the global stack — it runs on every request, in the order
added.

```ts
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger).use(cors);
  }
}
```

**Notes:** returns `this`, so calls chain. Runs after Keel's internal setup
middleware, so `c.get("app")` is available. Only accepts a `MiddlewareHandler`
(a function) — global middleware isn't named, so there's no string form here.

#### `onError(handler)`

`onError(handler: (err: unknown, c: Context) => Response | Promise<Response>): this`

Registers a custom error handler that takes precedence over the default
HTML/JSON exception rendering.

```ts
this.onError((err, c) => c.json({ error: String(err) }, 500));
```

**Notes:** returns `this`. Reportable exceptions still get their `report()` hook
called before your handler runs; your handler fully replaces the default
`renderException` output. Last call wins.

#### `build()`

`build(): Hono`

Compiles the router's collected routes onto a fresh Hono instance, mounting the
global middleware, per-route middleware, domain dispatch, and the not-found /
error handlers.

```ts
const hono = app.make(HttpKernel).build();  // done for you by `keel serve`
```

**Notes:** called by the framework at boot — you rarely call it yourself. Routes
bound to a `domain(...)` are compiled into per-host sub-apps and dispatched by
the `Host` header; everything else lands on the default app.

### `Router` (middleware methods)

The router (a container singleton — `app.make(Router)`) is where named middleware
lives. Its routing methods are documented in [routing](./routing.md); the
middleware-related surface is below.

#### `named(map)`

`named(map: Record<string, MiddlewareHandler>): this`

Registers named middleware, referenceable by name in `.use()` / `.middleware()`
on routes, groups, and resources.

```ts
router.named({ auth: authMiddleware, admin: adminMiddleware });
router.get("/dashboard", handler).use("auth");
```

**Notes:** merges into previously registered names (call it repeatedly). Values
must be handlers, not other names. Returns `this`.

#### `resolveMiddleware(ref)`

`resolveMiddleware(ref: MiddlewareRef): MiddlewareHandler`

Resolves a `MiddlewareRef` — a handler passes through unchanged; a string is
looked up in the named registry.

```ts
const mw = router.resolveMiddleware("auth");  // the registered authMiddleware
```

**Notes:** called by the kernel while compiling each route; you rarely call it
directly. Throws `No named middleware [name]. Register it with router.named({ name: … }).`
for an unknown name — which surfaces at build time, catching typos at boot.

### Applying middleware to routes

These live on the route builders returned by the router. Full signatures and
examples are in [routing](./routing.md); the middleware-relevant ones:

#### `Route.middleware(mw)` / `Route.use(mw)`

`middleware(mw: MiddlewareRef | MiddlewareRef[]): this`
`use(mw: MiddlewareRef | MiddlewareRef[]): this`

Attaches middleware that runs only for this route (after any group middleware).
`use` is an alias for `middleware`.

```ts
router.get("/dashboard", handler).use("auth");
router.get("/reports", handler).middleware(["auth", auditLog]);
```

**Notes:** appends — call repeatedly or pass an array to add several. Accepts
names or raw handlers (`MiddlewareRef`).

#### `RouteGroup.middleware(mw)` / `RouteGroup.use(mw)`

`middleware(mw: MiddlewareRef | MiddlewareRef[]): this`
`use(mw: MiddlewareRef | MiddlewareRef[]): this`

Attaches middleware to every route in the group. `use` is an alias.

```ts
router.group(() => {
  router.get("/dashboard", handler);
  router.get("/settings", handler);
}).use(["auth", "admin"]);
```

**Notes:** *prepends* to each route's middleware, so group middleware runs before
per-route middleware. Groups nest: an outer group's middleware wraps an inner
group's.

#### `RouteResource.use(actions, mw)`

`use(actions: string[] | "*", mw: MiddlewareRef | MiddlewareRef[]): this`

Attaches middleware to specific resource actions (`index`, `store`, `show`, …),
or `"*"` for all of them.

```ts
router.resource("posts", PostController).use(["store", "update", "destroy"], "auth");
router.resource("admin", AdminController).use("*", "admin");
```

**Notes:** the action names are the RESTful set (`index`, `create`, `store`,
`show`, `edit`, `update`, `destroy`). Non-matching actions are left untouched.

### Interfaces & types

#### `MiddlewareHandler` (from `hono`)

```ts
type MiddlewareHandler = (c: Context, next: Next) => Promise<Response | void>;
```

The shape every middleware implements — imported from `hono`, not Keel. Do work,
`await next()` to continue the stack, return a `Response` (or nothing). Return
early without calling `next()` to short-circuit.

```ts
import type { MiddlewareHandler } from "hono";

export const noCache: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};
```

#### `MiddlewareRef`

`type MiddlewareRef = MiddlewareHandler | string`

What `.use()` / `.middleware()` accept: either a middleware handler, or the name
of one registered with `router.named()`.

```ts
import type { MiddlewareRef } from "@shaferllc/keel/core";

const guards: MiddlewareRef[] = ["auth", auditLog]; // names and functions mix
router.get("/reports", handler).use(guards);
```
