<div align="center">

# Keel ⚓

**The house framework for Node.js.**

TypeScript · a real service container · convention-driven structure · a code-generating console.

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

Keel gives you the ergonomics that make you productive — a service container,
service providers, dot-notation config, expressive routing, and a
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
    return c.json({ app: config("app.name") });
  }
}
```

## Why Keel?

- **A real service container.** `bind` / `singleton` / `instance` / `make`.
  Everything resolves through it — the pattern that keeps apps testable and
  composable.
- **Service providers.** A `register()` → `boot()` lifecycle to configure the
  app in one place.
- **Convention over configuration.** `app/`, `config/`, `routes/`, `bootstrap/`
  — you always know where things live.
- **A code-generating console.** `keel serve`, `keel routes`, and `make:*`
  generators.
- **Typed end to end.** Strict TypeScript, no build step in dev (powered by
  `tsx`).
- **Thin and legible.** The whole framework is a few hundred lines in
  `src/core/`. No magic you can't read.

## Two pieces: the framework and your app

Keel is a **library** you install. New apps come from the generator (templates
ship inside the package so they cannot lag the framework):

```bash
npm create keeljs@latest my-app
cd my-app && npm install && npm run dev
```

End-to-end (local → Cloudflare or optional Keel Cloud):
[From install to deploy](./docs/from-install-to-deploy.md).

**Deploy on `*.keeljs.cloud` from your IDE** (same `keel-mcp` + a Cloud token):
[Keel Cloud — deploy from MCP](./docs/keel-cloud.md).

| Repo | Role |
|------|------|
| [`shaferllc/keel`](https://github.com/shaferllc/keel) (this repo) | The framework. Published as `@shaferllc/keel`. |
| Your app (via `create-keeljs`) | Routes, models, views — depends on `@shaferllc/keel`. |

## Install in your app

```bash
npm create keeljs@latest my-app
# or, into an existing project:
npm install @shaferllc/keel
```

```ts
import { Application, Router, config } from "@shaferllc/keel/core";
```

## Hack on the framework itself

```bash
git clone https://github.com/shaferllc/keel.git
cd keel
npm install
npm test
npm run typecheck
npm run build
npm run verify:release
```

Point a generated kit at your checkout with
`"@shaferllc/keel": "file:../keel"` while developing.

## The console

```bash
keel routes                         # list every registered route
keel serve --port 8080              # start the server on a chosen port
keel make:controller Post           # -> app/Controllers/PostController.ts
keel make:provider Billing          # -> app/Providers/BillingServiceProvider.ts
keel make:middleware Auth           # -> app/Http/Middleware/authMiddleware.ts
keel make:page users/[id]           # -> resources/pages/users/[id].tsx
keel make:command greet             # -> app/Commands/greet.ts
keel repl                           # a shell with the app booted
keel mcp                            # start the MCP server (docs + API for AI agents)
```

These run in **your app**, from its own `bin/keel.ts` — which is a few lines that
hand the console your application factory (see the [console guide](./docs/console.md)).

## Built for AI ⚓🤖

Keel is designed to be **written with an AI agent**. Alongside the human docs it
ships a machine-readable surface that stays generated-in-sync, never stale:

- **An MCP server.** `keel-mcp` exposes Keel's docs, its full public API (380+
  exports), the generators, and its conventions to any [MCP](https://modelcontextprotocol.io)
  client — and with `KEEL_CLOUD_TOKEN`, **deploys sites to `*.keeljs.cloud`**
  (`create_site` → preview → publish). See [Keel Cloud](./docs/keel-cloud.md).
  Connect it in Claude Code:
  ```bash
  claude mcp add keel -- npx -y keel-mcp
  # Cloud: add -e KEEL_CLOUD_TOKEN=… -e KEEL_CLOUD_URL=https://app.keeljs.cloud
  ```
  Tools: `keel_overview`, `keel_search_docs`, `keel_read_doc`, `keel_search_api`,
  `keel_list_generators`, `keel_scaffold`, plus `keel_cloud_*` when a token is set.
  Resources: `keel://overview`, `keel://llms-full`, `keel://docs/<slug>`.
- **[`AGENTS.md`](./AGENTS.md).** The agent playbook — the one import rule, the
  folder map, the container/provider model, a "how to add X" table, and the
  guardrails. `CLAUDE.md` points to it.
- **[`llms.txt`](./llms.txt) + [`llms-full.txt`](./llms-full.txt).** A
  [spec-compliant](https://llmstxt.org) doc index and a one-file concatenation of
  every guide, both shipped in the npm package for drop-in context.
- **Generators an agent can drive.** `keel_scaffold` (or `keel make:*`) emits the
  correct stub with the right imports and path for every construct.

Full guide: **[docs/ai.md](./docs/ai.md)**. Regenerate the surface after doc or
export changes with `npm run build:ai` (also runs automatically on `npm run build`).

## Project layout

```
src/core/            The framework
├─ container.ts      Service container — bind / singleton / instance / make
├─ application.ts    Kernel: env + config loading + provider lifecycle
├─ config.ts         Dot-notation config repository + env() helper
├─ provider.ts       ServiceProvider base class (register / boot)
├─ http/
│  ├─ router.ts      Route facade (closures or [Controller, method] tuples)
│  └─ kernel.ts      Global middleware + compiles routes onto Hono
├─ cli/              The console: commands, generators, the kernel that runs them
└─ index.ts          Public surface — apps import "@shaferllc/keel/core"

src/db/              Database adapters (D1, Postgres, libSQL)
src/api/             CRUD REST resources from a model
src/openapi/         Generates an OpenAPI spec from the routes
src/billing/         Subscription billing — Stripe + Paddle
src/gates/           Signup gates — invite codes & email allowlist
src/hosting/         Cloudflare / dump / secrets helpers for hosted apps
src/watch/           The debug dashboard
src/mcp/             The MCP server (docs + API for AI agents)
src/vite/            The Vite plugin

tests/               767 tests
docs/                Every guide, plus type-checked examples of each
scripts/             build-ai (llms.txt, the MCP manifest), verify-release
```

**There is no `app/` here.** Your application code — controllers, providers,
routes, config — lives in *your* repo, not the framework's. The
[starter app](https://github.com/shaferllc/keel-app) has the layout.

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
| [Getting Started](./docs/getting-started.md) | First route, controller, view, config |
| [From install to deploy](./docs/from-install-to-deploy.md) | create-keeljs → local → Cloudflare or Keel Cloud |
| [Keel Cloud](./docs/keel-cloud.md) | Deploy `*.keeljs.cloud` from `keel-mcp` (create → preview → publish) |
| [Starter kits](./docs/starter-kits.md) | Presets (`minimal` / `api` / `app` / `saas`) |
| [The Service Container](./docs/container.md) | Binding and resolving services, DI |
| [Service Providers](./docs/providers.md) | Plugin system: register/boot lifecycle, options |
| [Configuration](./docs/configuration.md) | `config/*.ts`, dot-notation, `env()` |
| [Routing](./docs/routing.md) | Closures, controller tuples, groups, resources, domains |
| [URL Builder](./docs/url-builder.md) | Named-route URLs, signed URLs |
| [Hashing & Encryption](./docs/hashing.md) | Password hashing, AES value encryption |
| [Controllers](./docs/controllers.md) | Classes, DI, single-action, lazy-loaded |
| [Request & Response](./docs/request-response.md) | Input, cookies, output, `abort()` |
| [Request Decorators](./docs/decorators.md) | Lazy, memoized per-request values |
| [Lifecycle Hooks](./docs/hooks.md) | onReady/onShutdown, graceful shutdown, onRoute |
| [Sessions](./docs/sessions.md) | Cookie-backed sessions, flash messages |
| [Authentication](./docs/authentication.md) | Session auth, guards, user provider |
| [Gates](./docs/gates.md) | Signup gating — invite codes & email allowlist |
| [Hosting](./docs/hosting.md) | Cloudflare, SQL dump, secrets for hosted Workers |
| [Authorization](./docs/authorization.md) | Ability gates & policies, `can`/`authorize` |
| [Database](./docs/database.md) | Driver-agnostic query builder |
| [Models](./docs/models.md) | Active-record: find/create/save, casts, relations |
| [Migrations](./docs/migrations.md) | Schema builder + migrator, dialect-aware |
| [Factories & Seeders](./docs/factories.md) | Built-in Faker, model factories, seeders |
| [Mail](./docs/mail.md) | Fluent mailer, pluggable transports, `sendLater()`, attachments |
| [Queues & Jobs](./docs/queues.md) | Dispatch jobs, retries + backoff, dead-letter, workers |
| [Task Scheduling](./docs/scheduling.md) | Cron-style recurring tasks, one trigger |
| [Notifications](./docs/notifications.md) | Multi-channel (mail/db), queueable |
| [Broadcasting](./docs/broadcasting.md) | Real-time channels, pluggable, presence auth |
| [API Resources](./docs/api-resources.md) | CRUD REST API from a model; deny-by-default access, row-level scope |
| [Transformers](./docs/transformers.md) | Shape models into API JSON; conditional fields, relations |
| [Events](./docs/events.md) | Emit/listen decoupling, async listeners |
| [Service Broker](./docs/broker.md) | Moleculer-style services, call/emit, pluggable transport |
| [Cache](./docs/cache.md) | TTLs, the remember pattern, pluggable stores |
| [Locks](./docs/locks.md) | Distributed locks with ownership + TTL, pluggable stores |
| [Redis](./docs/redis.md) | Pluggable client, memory driver, cache adapter |
| [Logger](./docs/logger.md) | Structured logging, sinks, per-request `reqId`, redaction |
| [Static Files](./docs/static-files.md) | serveStatic(), caching, dot-file safety |
| [Storage](./docs/storage.md) | Pluggable disks (local/S3/R2), signed URLs, direct uploads |
| [Health Checks](./docs/health.md) | `/health/live` + `/health/ready`, pluggable checks |
| [Telemetry](./docs/telemetry.md) | Tracing, W3C context, OTLP export — no SDK |
| [Internationalization](./docs/i18n.md) | ICU messages, `Intl` formatters, locale detection |
| [Pages](./docs/pages.md) | Page-based routing — a file is a route |
| [Packages](./docs/packages.md) | Redistributable slices of an app: routes, migrations, commands |
| [Billing](./docs/billing.md) | Subscriptions, charges & webhooks — Stripe + Paddle |
| [Watch](./docs/watch.md) | Debug dashboard — requests, queries, jobs, logs at `/watch` |
| [Views](./docs/views.md) | Hono JSX components, layouts, the View service |
| [Templates](./docs/templates.md) | `{{ }}` + `@`-tag templating engine, edge-safe |
| [Middleware](./docs/middleware.md) | Global middleware, writing your own |
| [Rate Limiting](./docs/rate-limiting.md) | rateLimiter() middleware, per-key buckets |
| [Errors](./docs/errors.md) | HTTP exceptions, debug page, custom handlers |
| [Testing](./docs/testing.md) | Inject requests, fakes, spies, time travel, db assertions |
| [Debugging](./docs/debugging.md) | dump() and dd() (dump-and-die) |
| [Validation](./docs/validation.md) | `validate()` with Zod, auto-422 field errors |
| [Inertia](./docs/inertia.md) | Server-side Inertia.js adapter |
| [Vite](./docs/vite.md) | Frontend build: HMR in dev, hashed manifest in prod |
| [The Console](./docs/console.md) | Typed commands, prompts, terminal UI, REPL, `make:*` |
| [Architecture](./docs/architecture.md) | Container, kernel, request lifecycle |
| [Built on Hono](./docs/hono.md) | The Hono layer underneath, and using it directly |
| [Building with AI](./docs/ai.md) | MCP server, `AGENTS.md`, `llms.txt`, agent workflow |

## Testing

The core has a test suite (Node's built-in runner + `tsx`, no extra tooling):

```bash
npm test              # run the suite
npm run test:coverage # with v8 coverage
```

Unit tests cover the container, config, view, exceptions, and validation; an
integration suite drives the HTTP kernel end-to-end (routing, request/response
helpers, error rendering, middleware, validation). Coverage sits at **~99%
lines / ~91% branches**.

## Requirements

- Node.js **≥ 22**
- No database or build step required for the MVP core.

## Roadmap

The MVP core and the major subsystems are shipped. Recent focus is Keel Cloud
support (gates, hosting, MCP Cloud tools, billing portal) and starter kits.
See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Contributing

Issues and PRs welcome. Run `npm run typecheck` before opening a PR.

## License

[MIT](./LICENSE) © 2026 Tom Shafer
