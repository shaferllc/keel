# Lifecycle Hooks

Tap into the **application lifecycle** — run code once the app is ready, clean up
on shutdown, and observe route registration.

> **Request-lifecycle hooks** (before/after a request, on error) are
> [middleware](./middleware.md) in Keel — `HttpKernel.use()`, route/group
> `.middleware()`, and `onError()`. This page is the *application* lifecycle:
> ready, shutdown, and route registration.

## onReady

Run a callback once the application has finished booting (all providers
registered and booted). Register it before boot; if the app is already booted, it
runs immediately.

```ts
import { onReady } from "@shaferllc/keel/core";

onReady(async (app) => {
  await warmCaches();
  logger().info("app ready");
});
```

## Graceful shutdown

`onShutdown` registers cleanup — closing database/Redis connections, flushing
queues, draining work. Hooks run **newest-first (LIFO)** when you call
`terminate()`, so teardown unwinds in the reverse order things were set up:

```ts
import { onShutdown, terminate } from "@shaferllc/keel/core";

onShutdown(async () => {
  await db().close?.();
  await redis().flushAll();
});
```

**`keel serve` already traps SIGINT and SIGTERM**, stops accepting connections,
and calls `terminate()` for you — so the hook above just runs. You only wire
signals by hand in a **custom entrypoint** that doesn't go through `keel serve`:

```ts
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await terminate(); // runs every shutdown hook
    process.exit(0);
  });
}
```

A [service provider](./providers.md)'s `shutdown()` method joins the same queue,
so provider teardown and hand-registered `onShutdown` hooks unwind together.
`terminate()` is **idempotent** — a second call does nothing. A hook that throws
doesn't stop the others; the first error is re-thrown after all have run, so one
failing cleanup can't strand the rest.

## onRoute

Observe routes as they're registered — for request logging, an API map, or
metrics. The hook is called for each route added *after* registration, and
replayed for routes already registered, so you see them all regardless of order:

```ts
const router = app.make(Router);

router.onRoute((def) => {
  logger().debug("route", { methods: def.methods, path: def.path, name: def.name });
});
```

The `def` is the live route definition, so reading it later reflects fluent
config applied after `add()` — `.name()`, `.middleware()`, and so on.

## API reference

### `onReady(hook)`

`onReady(hook: (app: Application) => void | Promise<void>): void`

Global helper — registers a ready hook on the active application. Runs after boot
(or immediately if already booted). Also available as `app.onReady(hook)`.

### `onShutdown(hook)`

`onShutdown(hook: (app: Application) => void | Promise<void>): void`

Registers a shutdown hook on the active application. Also `app.onShutdown(hook)`.

### `terminate()`

`terminate(): Promise<void>`

Gracefully shuts the active application down — runs every shutdown hook LIFO.
Idempotent. Re-throws the first hook error after running all. Also
`app.terminate()`.

### `Application.onReady` / `onShutdown` / `terminate`

The same three as methods on the `Application`, returning `this` (chainable) for
`onReady`/`onShutdown`. `app.isTerminated` reports whether `terminate()` has run.

### `Router.onRoute(hook)`

`onRoute(hook: (def: RouteDefinition) => void): this`

Called with each route's definition as it's registered, and replayed for existing
routes. Chainable.

### `LifecycleHook`

`type LifecycleHook = (app: Application) => void | Promise<void>`

The signature of `onReady` / `onShutdown` hooks.
