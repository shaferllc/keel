# Helpers

Keel gives you a handful of **global helper functions** so you can reach the
running application from anywhere — a route handler, a model, a plain function —
without threading a container reference through every call. `config('app.name')`,
`cache().get(…)`, `emit('user.registered', user)`: no `this.app`, no imports of
the container.

They all resolve against the **active application**, which registers itself the
moment an `Application` is constructed. In a normal single-app process — one Node
server, or one Worker isolate — that's exactly the app you mean, so the globals
just work.

```ts
import { config, cache, emit, logger, view } from "@shaferllc/keel/core";

const name = config<string>("app.name", "Keel");
const stats = await cache().remember("stats", 60, () => computeStats());
await emit("user.registered", user);
logger().info("welcome sent", { userId: user.id });
```

## How they resolve

Every helper is sugar over `app()` — the one helper that returns the active
`Application`. `config()` is `app().make(Config).get(…)`; `cache()` is
`app().make(Cache)`; `make()` is `app().make(…)`. So the whole set shares one
precondition: **an application must exist first.** Call any helper before
bootstrapping and `app()` throws:

```
No Keel application has been bootstrapped. Create an Application first.
```

In practice the application is created at boot, long before any request runs, so
you never see this outside of a bare unit test that forgot to construct one.

## The map

The helpers fall into groups, most of which have a dedicated guide. This page is
the quick index — reach for the deep doc when you need the full surface.

| Helper(s) | What it reaches | Deep dive |
| --- | --- | --- |
| `app` | the active `Application` | this page |
| `config` | configuration values | [configuration](./configuration.md) |
| `bind` `singleton` `instance` `make` `bound` | the service container | [container](./container.md) |
| `events` `emit` `listen` | the event emitter | [events](./events.md) |
| `cache` | the cache | [cache](./cache.md) |
| `logger` | the logger | [logger](./logger.md) |
| `view` | the view renderer | [views](./views.md) |

## Container helpers, up close

The five container helpers let you register and resolve services from anywhere,
exactly as `app().bind(…)` would — handy inside a factory or a helper function
that has no container reference of its own:

```ts
import { singleton, make, bound } from "@shaferllc/keel/core";

singleton(Mailer, (app) => new Mailer(app.make(Config)));
const mailer = make(Mailer);
if (bound("clock")) { /* someone registered it */ }
```

The factory you pass to `bind`/`singleton` receives the container, so a service
can resolve its own dependencies. Unlike the `Container` methods (which return
`this` to chain), the `bind`/`singleton` **helpers return `void`** — there's no
builder to chain off of at the global level. See [container](./container.md) for
the binding lifecycle, auto-resolution, and tokens.

## Events, cache, logger

`events()`, `cache()`, and `logger()` each return the singleton service, so you
call methods on the result:

```ts
import { events, cache, logger, listen, emit } from "@shaferllc/keel/core";

listen("order.paid", (order) => fulfil(order));   // subscribe
await emit("order.paid", order);                  // fan out, awaiting listeners
events().listenerCount("order.paid");             // the emitter itself

await cache().put("otp", code, 300);
logger().warn("retrying", { attempt: 2 });
```

`emit` and `listen` are shortcuts over `events().emit` / `events().on`, so you
rarely need `events()` directly — reach for it when you want `once`, `off`,
`listenerCount`, or `clear`. Full surface in [events](./events.md),
[cache](./cache.md), and [logger](./logger.md).

## Rendering a view

`view()` renders a component to a complete HTML document in one call — return it
straight from a handler. Props are type-checked against the component:

```ts
import { view } from "@shaferllc/keel/core";

function Welcome({ appName }: { appName: string }) {
  return `<h1>Welcome to ${appName}</h1>`;
}

return view(Welcome, { appName: "Keel" });  // Promise<string>
return view(HomePage);                        // no props
```

See [views](./views.md) for the component contract and async (Suspense) rendering.

## Related

These globals are the front door to services documented in depth elsewhere:
[configuration](./configuration.md), the [container](./container.md),
[events](./events.md), [cache](./cache.md), [logger](./logger.md), and
[views](./views.md). Everything here is a thin, typed shortcut into one of those.

---

## API reference

Every helper below is exported from `@shaferllc/keel/core`. All of them resolve
against the active application and therefore throw
`No Keel application has been bootstrapped…` if called before one is created.

### `app()`

`app(): Application`

Returns the active `Application` — the container everything else resolves out of.

```ts
import { app } from "@shaferllc/keel/core";

const port = app().config().get<number>("app.port", 3000);
```

**Notes:** throws if no application has been constructed yet. Every other helper
on this page is built on `app()`, so this is the single point where a
"no application" error can originate.

### `config(key, fallback?)`

`config<T = unknown>(key: string, fallback?: T): T`

Reads a configuration value by dot-path, returning `fallback` when the path is
missing.

```ts
config<string>("app.name");
config("app.port", 3000);   // 3000 if unset
```

**Notes:** shorthand for `app().make(Config).get(key, fallback)`. Read-only —
use `app().make(Config).set(…)` to write. See [configuration](./configuration.md).

### `view(component, props?)`

`view<P>(component: (props: P, ...rest: any[]) => Renderable, props: P): Promise<string>`
`view(component: (...rest: any[]) => Renderable): Promise<string>`

Renders a component (with optional props) to a complete HTML document.

```ts
return view(Welcome, { appName: "Keel" });
return view(HomePage);
```

**Notes:** props are type-checked against the component's parameter. Resolves to
a `Promise<string>` (a full HTML document, doctype included) — return it directly
from a route handler. Sugar over `app().make(View).render(component(props))`. See
[views](./views.md).

### `bind(token, factory)`

`bind<T>(token: Token<T>, factory: Factory<T>): void`

Registers a **transient** binding — the factory runs on every `make`.

```ts
bind("clock", () => new Date());
```

**Notes:** the factory receives the container. Returns `void` (the underlying
`Container.bind` returns `this`, but the helper does not). See
[container](./container.md).

### `singleton(token, factory)`

`singleton<T>(token: Token<T>, factory: Factory<T>): void`

Registers a **shared** binding — the factory runs once, then the value is cached.

```ts
singleton(Mailer, (app) => new Mailer(app.make(Config)));
```

**Notes:** the cached value lives for the life of the application. Returns
`void`. See [container](./container.md).

### `instance(token, value)`

`instance<T>(token: Token<T>, value: T): T`

Registers an already-constructed value as a shared instance, and returns it.

```ts
const version = instance("app.version", "0.30.0");
```

**Notes:** unlike `bind`/`singleton`, this returns the value you passed in, so
you can register-and-use in one expression. See [container](./container.md).

### `make(token)`

`make<T>(token: Token<T>): T`

Resolves a token out of the container.

```ts
const mailer = make(Mailer);
const version = make<string>("app.version");
```

**Notes:** a zero-arg class token resolves even without an explicit binding (the
container builds it); an unbound string/symbol token throws
`Nothing bound in the container for […]`. See [container](./container.md).

### `bound(token)`

`bound(token: Token): boolean`

`true` if the token has a binding or a cached instance.

```ts
if (bound("clock")) make<Date>("clock");
```

**Notes:** a guard for optional services. Note a class token that `make` could
auto-build still reports `false` here until it's explicitly bound. See
[container](./container.md).

### `events()`

`events(): Events`

Returns the application's event emitter singleton.

```ts
events().listenerCount("order.paid");
events().clear("order.paid");
```

**Notes:** use for `once`, `off`, `listenerCount`, and `clear`; for the common
subscribe/emit pair prefer `listen`/`emit` below. See [events](./events.md).

### `emit(event, payload?)`

`emit<T = unknown>(event: string, payload?: T): Promise<void>`

Emits an event, awaiting every listener in registration order.

```ts
await emit("user.registered", user);
```

**Notes:** shorthand for `events().emit(…)`. The returned promise resolves once
all listeners (including async ones) have run. No listeners → resolves
immediately. See [events](./events.md).

### `listen(event, listener)`

`listen<T = unknown>(event: string, listener: Listener<T>): () => void`

Subscribes to an event; returns an unsubscribe function.

```ts
const off = listen("user.registered", (user) => sendWelcome(user));
off(); // stop listening
```

**Notes:** shorthand for `events().on(…)`. The listener may be sync or async.
Call the returned function to remove it. See [events](./events.md).

### `cache()`

`cache(): Cache`

Returns the application's cache singleton.

```ts
const stats = await cache().remember("stats", 60, () => computeStats());
await cache().put("otp", code, 300);
```

**Notes:** memory-backed per process/isolate by default; swap the store via a
`singleton(Cache, …)` binding. See [cache](./cache.md).

### `logger()`

`logger(): Logger`

Returns the application's logger singleton.

```ts
logger().info("user registered", { userId: user.id });
logger().error("payment failed", { orderId });
```

**Notes:** structured JSON by default. `logger().child({ … })` returns a logger
with bound fields (e.g. a request id). See [logger](./logger.md).

### Interfaces & types

The helpers surface a few types from the services they front. You implement or
pass these; you rarely construct them here.

#### `Listener<T>`

`type Listener<T = unknown> = (payload: T) => void | Promise<void>`

The shape of a function passed to `listen`. Sync or async; the payload type
flows from `listen<T>`.

```ts
const onOrder: Listener<{ id: number }> = async (order) => fulfil(order.id);
listen("order.paid", onOrder);
```

#### `Token<T>` / `Factory<T>`

`type Token<T = unknown> = string | symbol | Constructor<T>`
`type Factory<T> = (app: Container) => T`

The key and the factory used by `bind`/`singleton`/`instance`/`make`/`bound`. A
token is a string, symbol, or class constructor; a factory receives the container
so it can resolve its own dependencies. Documented in full under
[container](./container.md).

#### `Renderable`

`type Renderable = string | Promise<string> | { toString(): string | Promise<string> } | null | undefined`

What a component passed to `view()` may return — a string, a JSX node, a promise
of either, or nullish (renders empty). Documented in full under
[views](./views.md).
