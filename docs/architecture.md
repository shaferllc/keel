# Architecture

Keel is small on purpose. This page maps the pieces and traces a request from
socket to response.

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

## Boot sequence

When `keel serve` runs:

1. **`createApplication()`** constructs the `Application` with the project root.
2. The constructor loads `.env` and binds core services (`Config`, `Router`).
3. **`app.boot(providers)`**:
   - loads every `config/*.ts` file into the `Config` repository,
   - runs each provider's **`register()`** (bind-only phase),
   - runs each provider's **`boot()`** (wire-up phase).
4. The HTTP kernel (`app/Http/Kernel.ts`) is bound as a singleton.
5. `routes/web.ts` registers routes on the `Router`.
6. `HttpKernel.build()` returns a Hono app; `@hono/node-server` serves it.

## Request lifecycle

For each incoming request:

```
request
  → Hono matches the route
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

## Design principles

- **One container, resolved everywhere.** Testability and composition follow
  from routing every dependency through it.
- **Convention over configuration.** Fixed folders (`app/`, `config/`,
  `routes/`, `bootstrap/`) mean no manual wiring for the common case.
- **Thin over clever.** The framework is a few hundred readable lines. When in
  doubt, open the source — there is no hidden magic.
- **Wrap the best, own the surface.** Hono does HTTP; Keel owns the developer-
  facing API so the underlying library can change without breaking your app.

## Extending Keel

The MVP core is deliberately small. Natural extension points:

- **New services** → a service provider that binds them into the container.
- **New console commands** → add to [cli/index.ts](../src/core/cli/index.ts).
- **New subsystems** (ORM, queues, mail) → a provider that registers the
  subsystem plus a `config/*.ts` file for its settings. This is exactly how the
  roadmap items will land.
