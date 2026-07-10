<div align="center">

# Keel ⚓

**A Laravel-flavored house framework for Node.js.**

TypeScript · a real service container · convention-driven structure · an artisan-style console.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org)

[Getting Started](./docs/getting-started.md) ·
[Container](./docs/container.md) ·
[Routing](./docs/routing.md) ·
[Providers](./docs/providers.md) ·
[Console](./docs/console.md)

</div>

---

Keel gives you the ergonomics that make Laravel productive — a service
container, service providers, dot-notation config, expressive routing, and a
code-generating console — on a modern TypeScript stack. [Hono](https://hono.dev)
powers the HTTP layer under the hood; everything above it is Keel's.

It is a **house framework**: small enough to read in an afternoon, opinionated
enough to ship on, and yours to extend.

```ts
// routes/web.ts
router.get("/", [HomeController, "index"]);
router.get("/hello/:name", (c) => c.text(`Hello, ${c.req.param("name")}!`));
```

```ts
// A controller — resolved from the container, so it gets dependency injection
export class HomeController {
  constructor(private app: Container) {}

  index(c: Ctx) {
    return c.json({ app: this.app.make(Application).config().get("app.name") });
  }
}
```

## Why Keel?

- **A real service container.** `bind` / `singleton` / `instance` / `make`.
  Everything resolves through it — the same pattern that makes Laravel testable
  and composable.
- **Service providers.** A `register()` → `boot()` lifecycle to configure the
  app in one place.
- **Convention over configuration.** `app/`, `config/`, `routes/`, `bootstrap/`
  — you always know where things live.
- **An artisan-style console.** `keel serve`, `keel routes`, and `make:*`
  generators.
- **Typed end to end.** Strict TypeScript, no build step in dev (powered by
  `tsx`).
- **Thin and legible.** The whole framework is a few hundred lines in
  `src/core/`. No magic you can't read.

## Quick start

```bash
git clone https://github.com/shaferllc/keel.git
cd keel
npm install
cp .env.example .env   # if present; otherwise .env already ships with defaults
npm run dev            # server on http://localhost:3000
```

```bash
curl localhost:3000/            # HomeController@index (JSON)
curl localhost:3000/ping        # inline closure route
curl localhost:3000/hello/Tom   # route parameter
```

## The console

```bash
npm run keel routes                 # list every registered route
npm run keel serve --port 8080      # start the server on a chosen port
npm run keel make:controller Post   # -> app/Controllers/PostController.ts
npm run keel make:provider Billing  # -> app/Providers/BillingServiceProvider.ts
npm run keel make:middleware Auth   # -> app/Http/Middleware/authMiddleware.ts
```

Under the hood the console binary is `bin/keel.ts`; the npm scripts wrap it with
`tsx`.

## Project layout

```
src/core/            The framework (destined to become @keel/core on npm)
├─ container.ts      Service container — bind / singleton / instance / make
├─ application.ts    Kernel: env + config loading + provider lifecycle
├─ config.ts         Dot-notation config repository + env() helper
├─ provider.ts       ServiceProvider base class (register / boot)
├─ http/
│  ├─ router.ts      Route facade (closures or [Controller, method] tuples)
│  └─ kernel.ts      Global middleware + compiles routes onto Hono
├─ cli/              The `keel` console and make: stubs
└─ index.ts          Public surface — userland imports "@keel/core"

app/                 Your application code
├─ Controllers/      Resolved from the container (dependency injection)
├─ Providers/        Register + wire services
└─ Http/
   ├─ Kernel.ts      Register global middleware here
   └─ Middleware/

bootstrap/           createApplication(): boots providers, loads routes
├─ app.ts
└─ providers.ts      The list of providers to load

config/              config/app.ts -> config('app.*')
routes/web.ts        Route definitions
```

The `app/` vs `src/core/` split mirrors Laravel's application-vs-vendor
separation: your code in `app/`, the framework in `src/core/`.

## The request lifecycle

1. `bin/keel.ts serve` calls `createApplication()` in `bootstrap/app.ts`.
2. The `Application` loads `.env`, then every `config/*.ts` file, then runs each
   provider's `register()` and `boot()`.
3. The HTTP kernel (`app/Http/Kernel.ts`) applies global middleware and compiles
   the collected routes onto a Hono instance.
4. `@hono/node-server` serves it. Each request flows through middleware →
   route handler (a closure or a container-resolved controller) → response.

See [docs/architecture.md](./docs/architecture.md) for the full picture.

## Documentation

| Guide | What it covers |
|-------|----------------|
| [Getting Started](./docs/getting-started.md) | Install, run, first route and controller |
| [The Service Container](./docs/container.md) | Binding and resolving services, DI |
| [Service Providers](./docs/providers.md) | The register/boot lifecycle |
| [Configuration](./docs/configuration.md) | `config/*.ts`, dot-notation, `env()` |
| [Routing](./docs/routing.md) | Closures, controller tuples, parameters |
| [Views](./docs/views.md) | Hono JSX components, layouts, the View service |
| [Middleware](./docs/middleware.md) | Global middleware, writing your own |
| [The Console](./docs/console.md) | `serve`, `routes`, `make:*` generators |
| [Architecture](./docs/architecture.md) | Container, kernel, request lifecycle |

## Requirements

- Node.js **≥ 22**
- No database or build step required for the MVP core.

## Roadmap

Keel's first release is the **MVP core**: container, routing, middleware,
config, and the console. On deck:

- [x] View / templating layer (Hono JSX) — **v0.2.0**
- [x] Cloudflare Workers–safe core — **v0.2.0**
- [ ] ORM / query builder + migrations (wrapping Drizzle)
- [ ] Validation (Zod)
- [ ] Queues (BullMQ), events, and mail
- [ ] Publish `src/core` as the `@keel/core` package

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Contributing

Issues and PRs welcome. Run `npm run typecheck` before opening a PR.

## License

[MIT](./LICENSE) © 2026 Tom Shafer
