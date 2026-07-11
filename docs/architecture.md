# Architecture

Keel is small on purpose. This page maps the pieces and traces a request from
socket to response. Nothing here is magic — every layer is a short, readable file
in `src/core/`, and this guide is mostly a reading order for it.

## The layers

```
┌─────────────────────────────────────────────────────────┐
│  bin/keel.ts            console entry (serve, make:*, …)  │
├─────────────────────────────────────────────────────────┤
│  bootstrap/app.ts       createApplication()              │
│    └─ boots providers, binds HTTP kernel, loads routes   │
├─────────────────────────────────────────────────────────┤
│  Application  (extends Container)                        │
│    ├─ loads .env + config/*.ts                           │
│    └─ provider register() → boot() lifecycle             │
├─────────────────────────────────────────────────────────┤
│  Container    bind / singleton / instance / make        │
├─────────────────────────────────────────────────────────┤
│  HttpKernel   global middleware → compiles routes → Hono │
├─────────────────────────────────────────────────────────┤
│  @hono/node-server   the actual HTTP server              │
└─────────────────────────────────────────────────────────┘
```

Read it top to bottom as the flow of control at boot, and bottom to top as the
flow of a request. The console and the server both enter through
`createApplication()` — the difference is only what they do with the app once
it's booted (serve it, or run a command against it).

## Core building blocks

- **`Container`** ([container.ts](../src/core/container.ts)) — the dependency
  registry. Two maps (bindings, cached instances) and a `make()` resolver.
- **`Application`** ([application.ts](../src/core/application.ts)) — a
  `Container` with a lifecycle: load env, auto-load config, register and boot
  providers.
- **`Config`** ([config.ts](../src/core/config.ts)) — a dot-notation repository
  plus the `env()` coercion helper.
- **`ServiceProvider`** ([provider.ts](../src/core/provider.ts)) — the
  `register()` / `boot()` contract.
- **`Router`** ([http/router.ts](../src/core/http/router.ts)) — collects route
  definitions; resolves controller tuples out of the container.
- **`HttpKernel`** ([http/kernel.ts](../src/core/http/kernel.ts)) — holds global
  middleware and compiles the router onto a Hono instance.

## The container is the center

Everything else hangs off the container. `Application` **is** a `Container` — it
extends it — so the same `bind` / `singleton` / `instance` / `make` surface that
registers a service also holds `Config`, `Router`, `View`, the `Logger`, and
your own controllers.

```ts
app.singleton(Router, (a) => new Router(a));   // registered at construction
const router = app.make(Router);               // resolved anywhere later
```

Two properties make this the spine of the framework:

- **Everything resolves through one place.** A controller doesn't `new` its
  dependencies — it receives the container in its constructor and pulls what it
  needs, so tests can swap any binding for a fake without touching the code under
  test.
- **Classes auto-resolve.** `make(SomeClass)` builds `SomeClass` even with no
  explicit binding, handing its constructor the container. You only register a
  binding when construction needs configuration or should be shared.

`bind` gives a fresh value each resolve; `singleton` caches after the first;
`instance` stores an already-built value. The global helpers (`make()`,
`bind()`, `config()`, `app()`) are thin wrappers that resolve against the active
application, so you rarely thread the container by hand. See
[The Service Container](./container.md) for the full API and resolution rules.

## Service providers wire it up

Providers are the seams where your services enter the container. Each has two
phases, and the split matters:

```ts
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Bind only. Nothing else is guaranteed registered yet.
    bind("clock", () => new Date().toISOString());
  }

  boot(): void {
    // Every provider has registered — safe to resolve and wire things.
  }
}
```

`Application.boot()` runs **all** providers' `register()` before **any**
provider's `boot()`. That ordering is the whole point: `register()` may only
add bindings, so `boot()` can safely depend on anything any provider bound,
regardless of order. Reaching for another service inside `register()` is the
classic bug — the binding may not exist yet. [Service Providers](./providers.md)
goes deeper.

## Boot sequence

When `keel serve` runs:

1. **`createApplication()`** constructs the `Application` with the project root.
2. The constructor registers the active application (for global helpers) and
   binds core services (`Config`, `Router`, `View`, `Events`, `Cache`,
   `Logger`).
3. **`app.boot(providers)`**:
   - loads `.env`, then every `config/*.ts` file into the `Config` repository,
   - runs each provider's **`register()`** (bind-only phase),
   - runs each provider's **`boot()`** (wire-up phase).
4. The HTTP kernel (`app/Http/Kernel.ts`) is bound as a singleton.
5. `routes/web.ts` registers routes on the `Router`.
6. `HttpKernel.build()` returns a Hono app; `@hono/node-server` serves it.

Steps 1–3 are identical whether you're serving or running a console command —
`createApplication()` is the single door in. Only steps 4–6 are HTTP-specific.

## Request lifecycle

For each incoming request:

```
request
  → Hono matches the route
  → contextStorage() stashes the context for the request helpers
  → context middleware sets c.get("app") = the container
  → global middleware stack (e.g. requestLogger) runs, in order
  → the route handler runs:
        • a closure           → called with (c)
        • a [Controller, m]   → controller resolved from the container,
                                 then method(c) is called (DI in the ctor)
  → the handler's return value becomes the response
        (a string is wrapped as HTML; a Response passes through)
  → middleware unwinds on the way back out
response
```

A few details worth knowing:

- **The context is stashed per request.** Before your middleware runs, the
  kernel enables Hono's `contextStorage()`. That's what lets the [request
  helpers](./request-response.md) (`request`, `param()`, `json()`) reach the
  current request without you passing `c` around.
- **Controllers are resolved lazily, per request.** The router turns a
  `[Controller, method]` tuple into a function that resolves the controller from
  the container when the route fires — so constructor DI runs against the live
  app. Tuples may also be `() => import(...)` loaders for code-splitting.
- **Errors funnel through the kernel.** A thrown `HttpException` renders at its
  status; anything else is a 500. The kernel content-negotiates — HTML for
  browsers, JSON otherwise — and hides internals unless `app.debug` is on.
  Unmatched routes go through the same path as a `NotFoundException`.

[Middleware](./middleware.md) covers the stack in detail, and [Routing](./routing.md)
covers how handlers are declared and matched.

## Edge-safe by design

Keel's core imports **no** Node built-ins at module load. `fs`, `path`, `url`,
and `dotenv` are pulled in **dynamically**, and only when filesystem
discovery is enabled:

```ts
// application.ts — dynamic, guarded, optional
const { readdir } = await import("node:fs/promises");
```

The payoff is that the same `Application`, `Router`, `View`, and query builder
run unchanged on Cloudflare Workers, Deno, and Bun — anywhere with web-standard
`fetch`, `Request`, `Response`, and Web Crypto. On Workers, where there's no
filesystem to scan, you skip discovery and pass config inline:

```ts
await app.boot(providers, { discoverConfig: false, config: { app: { name: "Keel" } } });
```

Everything that would normally reach for a platform API is designed around this
seam: the [database](./database.md) layer talks to a `Connection` you provide
rather than importing a driver; signed URLs use Web Crypto's `crypto.subtle`;
views render to strings with no filesystem. The rule is simple — the core owns
logic, the platform owns I/O, and the two meet at an interface you supply.

## Two repos: library and starter

Keel is distributed like most frameworks — a **library** you install plus an
**app** that depends on it:

| Repo | Role |
|------|------|
| `shaferllc/keel` | The framework. Published as `@shaferllc/keel`; userland imports `@shaferllc/keel/core`. |
| `shaferllc/keel-app` | The starter app — clone it to build something. Picks up core updates via `npm update`. |

The split mirrors the classic application-vs-library separation. Your code lives
in `app/` (controllers, providers, middleware); the framework lives behind the
package boundary. Because the two are versioned separately, a framework upgrade
is an ordinary dependency bump — your `app/` doesn't move. [Getting
Started](./getting-started.md#install) walks through both install paths.

## Design principles

- **One container, resolved everywhere.** Testability and composition follow
  from routing every dependency through it.
- **Convention over configuration.** Fixed folders (`app/`, `config/`,
  `routes/`, `bootstrap/`) mean no manual wiring for the common case.
- **Thin over clever.** The framework is a few hundred readable lines. When in
  doubt, open the source — there is no hidden magic.
- **Wrap the best, own the surface.** Hono does HTTP; Keel owns the developer-
  facing API so the underlying library can change without breaking your app.
  [Built on Hono](./hono.md) draws that line precisely.

## Extending Keel

The MVP core is deliberately small. Natural extension points:

- **New services** → a service provider that binds them into the container.
- **New console commands** → add to [cli/index.ts](../src/core/cli/index.ts).
- **New subsystems** (ORM, queues, mail) → a provider that registers the
  subsystem plus a `config/*.ts` file for its settings. This is exactly how the
  roadmap items will land.
