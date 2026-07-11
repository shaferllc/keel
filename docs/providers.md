# Service Providers

Service providers are the central place to configure your application. Nearly
everything Keel boots — config, routing, your own services — is wired up in a
provider.

## The lifecycle

A provider has two methods, run in two distinct phases:

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
}
```

The `Application` runs **all** `register()` methods first, then **all** `boot()`
methods. That ordering is what lets providers depend on each other without
worrying about load order.

Both methods may be `async` — the application awaits them.

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

#### `constructor(app)`

`constructor(app: Application)`

Receives the live `Application` and stores it as the `protected` `this.app`. The
`Application` invokes this for you (`new Provider(app)`); you don't call it.

```ts
// The Application does this internally when you register the class:
// new BillingServiceProvider(app);
```

**Notes:** `app` is `protected`, so it's reachable from subclass methods
(`this.app`) but not from outside the instance. There is no other constructor
parameter — a provider is just its two lifecycle hooks over the container.

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
