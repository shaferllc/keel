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
import { ServiceProvider } from "@shaferllc/keel/core";

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

## The short way: global helpers

You don't need `this.app` at all. The same operations exist as global helpers
that resolve against the active application — bind and resolve from anywhere:

```ts
import { bind, singleton, instance, make, bound } from "@shaferllc/keel/core";

bind("clock", () => new Date());              // transient
singleton(Mailer, (app) => new Mailer(app));   // shared
instance("version", "0.6.0");                  // pre-built value

const mailer = make(Mailer);
const version = make<string>("version");
if (bound("clock")) { /* … */ }
```

Both styles work everywhere; the helpers are just less to type.

## Resolving

Use `make()` (or `this.app.make()`) to pull something out:

```ts
const mailer = make(Mailer);
const version = make<string>("version");
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

Auto-resolution is transient: an unbound class is rebuilt every `make()` — it is
never cached, because nothing marked it shared. Bind it with `singleton` if you
want one instance.

### When nothing is bound

`make()` only auto-constructs **class** tokens. A string or symbol that was never
bound has nothing to build, so it throws:

```ts
make("nope"); // Error: Nothing bound in the container for [nope].
```

Guard with `bound()` when a token might be missing:

```ts
const clock = bound("clock") ? make<Date>("clock") : new Date();
```

## Dependency injection in controllers

Controllers are resolved through the container, so their constructor receives
it. Pull whatever you need:

```ts
import type { Ctx } from "@shaferllc/keel/core";
import { Application, type Container } from "@shaferllc/keel/core";

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

## Related

Bindings usually live in a [service provider](./providers.md)'s `register()`
method; the global helpers resolve against the active [`Application`](./application.md),
which registers itself on construction.

---

## API reference

### Container

The registry itself. You rarely construct it — the `Application` is a `Container`,
and you reach it as `this.app` inside providers/controllers or via the global
helpers below. Registration methods (`bind`, `singleton`) return `this` and so
chain; resolution methods return the value.

#### `bind(token, factory)`

`bind<T>(token: Token<T>, factory: Factory<T>): this`

Registers a transient binding — the factory runs on every resolve, yielding a
fresh value each time.

```ts
app.bind("clock", () => new Date());
app.bind(Mailer, (c) => new Mailer(c.make("config")));
```

**Notes:** returns `this`, so calls chain. Re-binding the same token overwrites
the prior binding. The factory receives the container, so it can resolve its own
dependencies.

#### `singleton(token, factory)`

`singleton<T>(token: Token<T>, factory: Factory<T>): this`

Registers a shared binding — the factory runs at most once; the result is cached
and returned on every later resolve.

```ts
app.singleton(Mailer, (c) => new Mailer(c.make("config")));
```

**Notes:** returns `this`. The factory is lazy — it doesn't run until the first
`make()`. The cached value lives in the instance map, so a later `bound()` is
`true` even before first resolve (the binding is registered immediately).

#### `instance(token, value)`

`instance<T>(token: Token<T>, value: T): T`

Registers an already-constructed value as a shared instance, skipping any factory.

```ts
const version = app.instance("version", "0.30.0"); // returns "0.30.0"
```

**Notes:** returns the value you passed (not `this`), so it reads well inline.
Overrides any cached instance for the token. Because it writes the instance map,
`make()` returns it directly without ever consulting a binding.

#### `make(token)`

`make<T>(token: Token<T>): T`

Resolves a token: returns a cached instance if present, else runs its binding
(caching the result for singletons), else auto-constructs an unbound class.

```ts
const mailer = app.make(Mailer);
const version = app.make<string>("version");
```

**Notes:** resolution order is instance cache → binding → class auto-build. An
unbound **class** token is built via `build()` and **not** cached. An unbound
string/symbol token throws `Nothing bound in the container for [token].`

#### `get(token)`

`get<T>(token: Token<T>): T`

Alias for `make()` — identical behavior, sugar for an `app(token)`-style read.

```ts
const mailer = app.get(Mailer);
```

**Notes:** delegates straight to `make()`; use whichever name reads better.

#### `build(ctor)`

`build<T>(ctor: Constructor<T>): T`

Instantiates a class directly, passing the container to its constructor. Bypasses
bindings and the instance cache entirely.

```ts
const report = app.build(ReportService); // new ReportService(app)
```

**Notes:** always constructs a new instance (never cached), and ignores any
binding registered for the class. `make()` calls this under the hood when it
auto-resolves an unbound class token.

#### `bound(token)`

`bound(token: Token): boolean`

Reports whether the token has a binding **or** a cached instance.

```ts
if (app.bound("clock")) app.make("clock");
```

**Notes:** `true` for singletons even before first resolve (the binding exists).
Does not consider auto-resolvable classes — an unbound class is `bound() === false`
yet still `make()`-able.

### Global helpers

Free functions in [`src/core/helpers.ts`](../src/core/helpers.ts) that proxy to
the active application's container, so you can bind and resolve from anywhere
without threading `this.app` through. Each calls `app()` internally, which throws
if no `Application` has been bootstrapped.

#### `bind(token, factory)`

`bind<T>(token: Token<T>, factory: Factory<T>): void`

Transient binding on the active application.

```ts
import { bind } from "@shaferllc/keel/core";
bind("clock", () => new Date());
```

**Notes:** returns `void` — unlike `Container.bind`, it does **not** return the
container, so these helpers don't chain.

#### `singleton(token, factory)`

`singleton<T>(token: Token<T>, factory: Factory<T>): void`

Shared binding on the active application.

```ts
import { singleton } from "@shaferllc/keel/core";
singleton(Mailer, (app) => new Mailer(app));
```

**Notes:** returns `void`. Same lazy, resolve-once semantics as `Container.singleton`.

#### `instance(token, value)`

`instance<T>(token: Token<T>, value: T): T`

Registers a pre-built value on the active application; returns the value.

```ts
import { instance } from "@shaferllc/keel/core";
const version = instance("version", "0.30.0");
```

**Notes:** the one container helper that returns its value (mirrors
`Container.instance`), so it composes inline.

#### `make(token)`

`make<T>(token: Token<T>): T`

Resolves a token out of the active application's container.

```ts
import { make } from "@shaferllc/keel/core";
const mailer = make(Mailer);
const version = make<string>("version");
```

**Notes:** same resolution rules and throw-on-missing behavior as `Container.make`.

#### `bound(token)`

`bound(token: Token): boolean`

Whether the token is bound or cached on the active application.

```ts
import { bound } from "@shaferllc/keel/core";
if (bound("clock")) { /* … */ }
```

**Notes:** proxies `Container.bound`.

### Interfaces & types

#### `Token`

`type Token<T = unknown> = string | symbol | Constructor<T>`

What every binding is keyed by. Use a string/symbol for values and interfaces, or
a class — which doubles as its own token and can be auto-resolved when unbound.

```ts
const nameKey: Token<string> = "app.name";
const svcKey: Token<Mailer> = Mailer; // the class is the token
```

#### `Constructor`

`type Constructor<T = unknown> = new (...args: any[]) => T`

Any newable class. A class token is a `Constructor`; `build()` and auto-resolution
call `new ctor(container)` on it, so the constructor's first parameter receives the
container.

```ts
const ctor: Constructor<ReportService> = ReportService;
```

#### `Factory`

`type Factory<T> = (app: Container) => T`

The builder function you hand to `bind`/`singleton`. It receives the container, so
it can resolve dependencies while constructing the value.

```ts
const mailerFactory: Factory<Mailer> = (app) => new Mailer(app.make("config"));
```
