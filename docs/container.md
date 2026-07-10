# The Service Container

The container is the backbone of Keel. Every service — config, the router,
controllers, and anything you write — is registered in it and resolved out of
it. It is the single registry every service resolves out of.

## Why a container?

Instead of `import`ing concrete classes everywhere and `new`ing them by hand,
you _bind_ how a service is built once, then _resolve_ it wherever you need it.
That gives you a single place to swap implementations (real vs. fake in tests),
share singletons, and inject dependencies.

## Binding

Bindings live in a service provider's `register()` method (see
[Providers](./providers.md)). A binding is keyed by a **token** — a string,
symbol, or class — and a **factory** that receives the container.

```ts
import { ServiceProvider } from "@keel/core";

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Transient: a fresh value every time it is resolved.
    this.app.bind("clock", () => new Date());

    // Singleton: built once, then cached.
    this.app.singleton(Mailer, (app) => new Mailer(app.make("config")));

    // Instance: register an already-constructed value.
    this.app.instance("version", "0.1.0");
  }
}
```

## Resolving

Use `make()` (or its alias `get()`) to pull something out:

```ts
const mailer = this.app.make(Mailer);
const version = this.app.make<string>("version");
```

If a token is bound, its factory runs (once, for singletons). If you pass an
**unbound class**, the container auto-constructs it, passing itself to the
constructor:

```ts
class ReportService {
  constructor(private app: Container) {}
}

const report = app.make(ReportService); // works with no explicit binding
```

## Dependency injection in controllers

Controllers are resolved through the container, so their constructor receives
it. Pull whatever you need:

```ts
import type { Ctx } from "@keel/core";
import { Application, type Container } from "@keel/core";

export class InvoiceController {
  constructor(private app: Container) {}

  index(c: Ctx) {
    const config = this.app.make(Application).config();
    return c.json({ currency: config.get("app.currency", "USD") });
  }
}
```

## The API

| Method | Purpose |
|--------|---------|
| `bind(token, factory)` | Transient binding — fresh value each resolve |
| `singleton(token, factory)` | Shared binding — resolved once, then cached |
| `instance(token, value)` | Register a pre-built value as a shared instance |
| `make(token)` / `get(token)` | Resolve a token |
| `bound(token)` | Whether a token is bound or cached |
| `build(ctor)` | Instantiate a class, passing it the container |

## Tokens

- **Strings/symbols** — good for values and interfaces: `"config"`, `"clock"`.
- **Classes** — good for services; the class doubles as its own token and can be
  auto-resolved when unbound.

## Under the hood

The whole container is about 90 lines in
[`src/core/container.ts`](../src/core/container.ts). Two maps — one for bindings,
one for cached instances — and a `make()` that checks the cache, runs the
factory, and caches shared results. Read it; there's no magic.
