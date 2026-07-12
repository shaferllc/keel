# Service Providers

Service providers are the central place to configure your application. Nearly
everything Keel boots — config, routing, your own services — is wired up in a
provider.

## The lifecycle

A provider has four hooks, run across the application's lifecycle. Only
`register()` and `boot()` are needed day-to-day; `ready()` and `shutdown()` are
there for work that must happen once the whole app is live, or as it stops:

```ts
import { ServiceProvider } from "@shaferllc/keel/core";

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Phase 1. Bind things into the container.
    // Do NOT resolve other services here — nothing is guaranteed
    // to be registered yet.
  }

  boot(): void {
    // Phase 2. Runs after EVERY provider has registered.
    // Safe to resolve services and wire them together.
  }

  ready(): void {
    // Phase 3. Runs after every provider has booted and the app is fully up.
    // For work that needs a live app — warm a cache, attach to the server.
  }

  shutdown(): void {
    // Phase 4. Runs on graceful termination, in reverse registration order.
    // Close connections, flush queues, cancel timers.
  }
}
```

The `Application` runs **all** `register()` methods first, then **all** `boot()`
methods, then **all** `ready()` methods — that ordering is what lets providers
depend on each other without worrying about load order. On `app.terminate()`
(wired to SIGINT/SIGTERM by `keel serve`), every `shutdown()` runs in **reverse**
registration order (LIFO), so a provider tears down before the ones it depended
on. All four hooks may be `async` — the application awaits them. `ready()` and
`shutdown()` are optional and map onto the app's `onReady()` / `onShutdown()`
hooks, so a provider's `shutdown()` runs alongside any it registered by hand.

## The `app` reference

Every provider is handed the `Application` at construction and holds it as
`this.app` (a `protected` field). The `Application` **is** the service container,
so `this.app` gives you `bind`, `singleton`, `instance`, `make`, and `bound`
directly, plus the framework accessors `config()`, `router()`, and `view()`:

```ts
import { ServiceProvider } from "@shaferllc/keel/core";
import { SearchIndex } from "../Services/SearchIndex.js";

export class SearchServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton("search", () => new SearchIndex());
  }

  boot(): void {
    const debug = this.app.config().get("app.debug", false);
    this.app.router().get("/health", () => "ok");
  }
}
```

You never construct a provider yourself — the `Application` does it for you when
you register the class. It calls `new Provider(app)`, so `this.app` is always the
live application instance.

## Registering a provider

Add your provider class to `bootstrap/providers.ts`:

```ts
import type { ProviderClass } from "@shaferllc/keel/core";
import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { BillingServiceProvider } from "../app/Providers/BillingServiceProvider.js";

export const providers: ProviderClass[] = [
  AppServiceProvider,
  BillingServiceProvider,
];
```

Providers boot in array order. Under the hood, `app.boot(providers)` calls
`app.register(Provider)` for each class — which does `new Provider(app)` and
stashes the instance — then runs the two phases across the whole set.

## Providers are Keel's plugin system

A service provider is Keel's answer to a **plugin**: a self-contained slice of
functionality you register into the app. To make one **reusable**, register it
with **options** — they arrive as `this.options`, typed via the generic:

```ts
class RateLimitProvider extends ServiceProvider<{ max: number }> {
  boot() {
    this.app.make(HttpKernel).use(rateLimiter({ max: this.options.max }));
  }
}

app.register(RateLimitProvider, { max: 100 }); // parameterized, like a plugin
```

The same provider class can be registered more than once with different options.
Without options, `this.options` is an empty object.

> Keel providers are **not encapsulated** — bindings, decorators, and routes are
> registered into the one global container. That's a deliberate simplification:
> there's a single, predictable scope, and no plugin-boundary rules to reason
> about. For per-request behavior in the HTTP pipeline (auth, logging, etc.),
> reach for [middleware](./middleware.md), which *is* scoped to the routes you
> attach it to.

## Generating a provider

```bash
npm run keel make:provider Billing
```

Writes `app/Providers/BillingServiceProvider.ts`. Remember to add it to
`bootstrap/providers.ts`.

## A realistic example

```ts
import { ServiceProvider, Config } from "@shaferllc/keel/core";
import { StripeClient } from "../Services/StripeClient.js";

export class BillingServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(StripeClient, (app) => {
      const key = app.make(Config).get<string>("services.stripe.key");
      return new StripeClient(key);
    });
  }

  boot(): void {
    // e.g. register webhooks, warm a cache, etc.
  }
}
```

Now any controller or service can `this.app.make(StripeClient)` and get the same
configured instance.

## Async providers

Both phases may return a promise, and the application `await`s each one before
moving on. Reach for this when a binding needs to open a connection or fetch a
remote manifest:

```ts
import { ServiceProvider } from "@shaferllc/keel/core";
import { SearchClient } from "../Services/SearchClient.js";

export class SearchServiceProvider extends ServiceProvider {
  async register(): Promise<void> {
    const client = await SearchClient.connect(process.env.SEARCH_URL!);
    this.app.instance(SearchClient, client);
  }

  async boot(): Promise<void> {
    await this.app.make(SearchClient).warm();
  }
}
```

Because every `register()` is awaited before any `boot()` runs, an async
`register()` in one provider still completes before another provider's `boot()`
tries to resolve what it bound.

## Error behavior

`register()` and `boot()` run inside `app.boot()`, which awaits each call in
sequence. If any provider throws (or rejects), `app.boot()` rejects and the
remaining providers never run — so a bad binding fails the whole boot loudly
rather than leaving a half-wired container. Booting is also idempotent: once
`app.boot()` has completed, calling it again returns immediately without
re-running any provider.

## Rules of thumb

- **`register()` binds. `boot()` uses.** Resolving a service in `register()` is
  the most common mistake — the thing you need may not be bound yet.
- **Keep providers focused.** One provider per concern (billing, auth, search)
  reads better than one giant `AppServiceProvider`.
- **Order matters only for `boot()` side effects**, since all registration
  happens before any booting.

## Related

Providers wire services into the [container](./container.md); the
[Application](./architecture.md) kernel constructs and boots them. See
[configuration](./configuration.md) for what `this.app.config()` reads.

---

## API reference

### `ServiceProvider`

The abstract base class every provider extends. You never instantiate it
directly — you subclass it and register the subclass (via `bootstrap/providers.ts`
or `app.register()`), and the `Application` constructs it for you. Override
`register()` and/or `boot()`; both are no-ops by default.

```ts
import { ServiceProvider } from "@shaferllc/keel/core";

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.bind("clock", () => new Date().toISOString());
  }
}
```

**Notes:** `abstract`, so it can't be `new`ed on its own. A subclass needn't
override both methods — leave one off to inherit the empty default.

#### `constructor(app, options?)`

`constructor(app: Application, options?: O)` (on `ServiceProvider<O>`)

Receives the live `Application` (stored as `protected this.app`) and the options
passed to `register` (stored as `protected this.options`, `{}` if none). The
`Application` invokes this for you; you don't call it.

```ts
class RateLimitProvider extends ServiceProvider<{ max: number }> {
  boot() {
    this.app.make(HttpKernel).use(rateLimiter({ max: this.options.max }));
  }
}
app.register(RateLimitProvider, { max: 100 });
```

**Notes:** `app` and `options` are `protected` — reachable from subclass methods,
not from outside. Type the options via the class generic `ServiceProvider<O>`.

#### `app.register(Provider, options?)`

`register(Provider: ProviderClass, options?: unknown): this`

Registers a provider, optionally with options handed to its constructor. Chainable.
`app.boot([Providers])` registers each without options.

#### `register()`

`register(): void | Promise<void>`

Phase-one hook: bind services into the container. Called for every provider
before any `boot()` runs. Default implementation is empty.

```ts
register(): void {
  this.app.singleton(StripeClient, (app) =>
    new StripeClient(app.make(Config).get<string>("services.stripe.key")),
  );
}
```

**Notes:** do **not** resolve other services here — another provider may not have
bound them yet. May be `async`; the application awaits it. Throwing rejects
`app.boot()`.

#### `boot()`

`boot(): void | Promise<void>`

Phase-two hook: runs after **every** provider has registered, so it's safe to
resolve services and wire them together. Default implementation is empty.

```ts
async boot(): Promise<void> {
  await this.app.make(SearchClient).warm();
}
```

**Notes:** providers boot in registration (array) order — the only place order
matters, since all `register()` calls finish first. May be `async`; the
application awaits it. Throwing rejects `app.boot()`.

#### `ready()`

`ready(): void | Promise<void>`

Phase-three hook: runs after **every** provider has booted and the app is fully
up (after the app's own `onReady` hooks). For work that needs a live app —
warming a cache, attaching to the running server. Default implementation is
empty.

```ts
async ready(): Promise<void> {
  await this.app.make(Cache).warm(["home", "pricing"]);
}
```

**Notes:** runs in registration order, once, at the end of `app.boot()`. Optional
— omit it and nothing runs. May be `async`; the application awaits it.

#### `shutdown()`

`shutdown(): void | Promise<void>`

Cleanup hook: runs on `app.terminate()` (which `keel serve` wires to SIGINT and
SIGTERM) in **reverse** registration order. Close database/Redis connections,
flush logs, cancel timers. Default implementation is empty.

```ts
async shutdown(): Promise<void> {
  await this.app.make(Redis).quit();
}
```

**Notes:** LIFO — the last provider registered shuts down first, so a provider
tears down before the ones it depends on. It joins the app's `onShutdown` hooks,
so a hook a provider registered by hand and its `shutdown()` both run. A throw
doesn't stop the others; the first error is re-thrown after all have run.

#### `app` (protected property)

`protected app: Application`

The application/container this provider configures. Use it in `register()` to
bind and in `boot()` to resolve.

```ts
boot(): void {
  const level = this.app.config().get("logger.level", "info");
}
```

**Notes:** it's the same `Application` instance across every provider, exposing
the container methods (`bind`, `singleton`, `instance`, `make`, `bound`) plus
`config()`, `router()`, and `view()`. Being `protected`, it's only visible to
subclass code.

### Interfaces & types

#### `ProviderClass`

`type ProviderClass = new (app: Application) => ServiceProvider`

The constructor type of a provider — a class (not an instance) that takes an
`Application` and yields a `ServiceProvider`. Use it to type the array you export
from `bootstrap/providers.ts` and anywhere you pass provider classes around.

```ts
import type { ProviderClass } from "@shaferllc/keel/core";
import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

export const providers: ProviderClass[] = [AppServiceProvider];
```

**Notes:** it references the class itself, so entries are the class name with no
`new` and no parentheses. `app.register()` and `app.boot()` both accept these.
