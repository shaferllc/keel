# Middleware

Middleware wraps every request, running code before and after your route
handler. Keel uses Hono's middleware signature.

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

Call `this.use(...)` once per middleware. They run in the order added.

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

Generate a stub with:

```bash
npm run keel make:middleware Auth
# -> app/Http/Middleware/authMiddleware.ts
```

## Named middleware

Register middleware by name once, then reference it by name on routes and groups
— no importing the function everywhere:

```ts
// bootstrap/app.ts, before routes are registered
router.named({
  auth: authMiddleware,
  admin: adminMiddleware,
});

// routes/web.ts
router.get("/dashboard", [DashboardController, "index"]).use("auth");
router.group(() => { /* … */ }).use(["auth", "admin"]);
router.resource("posts", PostController).use(["store", "update"], "auth");
```

You can still pass raw functions anywhere a name is accepted — mix and match.
Referencing an unregistered name throws when the app builds, so typos surface
immediately.

For **parameterized** middleware, use a factory that returns a handler:

```ts
const role = (name: string): MiddlewareHandler => async (c, next) => {
  // check role === name …
  await next();
};

router.get("/admin", handler).use(role("admin"));
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
Keel does it for `app`).

## Order of execution

```
requestLogger  ┐            ┌  requestLogger
               ▼            │
requireApiKey ─┼─► handler ─┘
```

Middleware added first is outermost: it runs first on the way in and last on the
way out.
