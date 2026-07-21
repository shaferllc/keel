# AGENTS.md — working in Keel with an AI agent

Guidance for AI coding agents (Claude Code, Cursor, …) editing **Keel** — the
house framework for Node.js — or an app built on it. Humans: this is also a fast
orientation. For prose guides see [`docs/`](./docs); for a machine-readable
surface, run the [MCP server](#mcp-server-recommended).

> **The fastest path:** follow
> [`docs/from-install-to-deploy.md`](./docs/from-install-to-deploy.md)
> (create-keeljs → local → Cloudflare or optional Keel Cloud). To deploy on
> `*.keeljs.cloud` from MCP, see [`docs/keel-cloud.md`](./docs/keel-cloud.md).
> For deep lookups, connect the MCP server and call `keel_overview`, then
> `keel_search_docs` / `keel_search_api`.

---

## What Keel is

A small, legible MVC framework: a real **service container**, **service
providers**, dot-notation **config**, expressive **routing**, active-record
**models**, a **queue**, **auth**, and a code-generating **console**.
[Hono](https://hono.dev) powers HTTP; everything above it is Keel's. The whole
core is a few hundred lines per file in `src/core/` — read it, nothing is magic.

## The one import rule

Everything userland comes from a single entry point:

```ts
import { Router, Model, config, ServiceProvider } from "@shaferllc/keel/core";
```

- **In a consuming app** (the `keel-app` starter, or your own): use
  `@shaferllc/keel/core`. This is what generated stubs emit.
- **Inside this framework repo's example app** (`app/`, `routes/`, `bootstrap/`):
  the code uses the `@keel/core` tsconfig **path alias** that points at
  `src/core/`. Match the file you're editing — don't "fix" `@keel/core` to the
  package name inside this repo.

Never deep-import `@shaferllc/keel/core/model.js`. If a symbol isn't exported
from `/core`, that's intentional. Find exports with `keel_search_api` or read
`src/core/index.ts`.

## Folder layout of a Keel app

| Path | What lives there |
|------|------------------|
| `app/Controllers/` | Controller classes (resolved from the container → DI) |
| `app/Providers/` | Service providers (`register()` then `boot()`) |
| `app/Http/Middleware/` | Hono middleware handlers |
| `app/Http/Kernel.ts` | The HTTP kernel — global middleware, error handling |
| `app/Models/` | Active-record models extending `Model` |
| `app/Jobs/`, `app/Notifications/`, `app/Transformers/` | Queue jobs, notifications, API serializers |
| `config/*.ts` | Config files; read via `config("app.name")` |
| `routes/web.ts` | Route definitions — default export receives the `Router` |
| `database/factories/`, `database/seeders/`, `database/migrations/` | Data tooling |
| `bootstrap/app.ts` | Assembles the `Application`, boots providers, loads routes |
| `.env` | Environment, loaded into `env(...)` and config |

## Core mental model

1. **Container.** Every service is registered in and resolved out of the
   container. `bind` (transient), `singleton` (once), `instance` (existing
   value), `make(Token)` (resolve). Constructor injection: a controller/service
   with `constructor(private app: Container)` gets it automatically.
2. **Providers.** `register()` binds things into the container; `boot()` runs
   after all providers registered, to wire things together. Register providers
   in `bootstrap/providers.ts`.
3. **Config.** `config("app.port", 3000)` reads `config/app.ts` merged with
   `.env`. Dot-notation, with a default.
4. **Routing.** `router.get("/x", [Controller, "method"])` or a closure. Name
   routes with `.name()`, group with `.group()`, constrain params with
   `.where()`, build URLs with `router.url("name", params)`.
5. **Request context.** Inside a handler, `param()`, `query()`, `body()`,
   `json()`, `text()` read/write the current request via async-local context —
   no need to thread `c` everywhere (though the Hono `Ctx` is available).

## How to add things (prefer the generators)

Use `keel_scaffold` (MCP) or the console — both emit the correct stub with the
right imports and target path. Then wire it up.

| Goal | Command | Then |
|------|---------|------|
| Controller | `keel make:controller Post` (`-r` for REST) | add a route in `routes/web.ts` |
| Provider | `keel make:provider Billing` | register in `bootstrap/providers.ts` |
| Middleware | `keel make:middleware Auth` | attach in `app/Http/Kernel.ts` or per-route |
| Model | `keel make:model Post` (`-m` migration, `-f` factory, `-c` controller) | set `fillable`; add relations |
| Migration | `keel make:migration create_posts` (name shapes the stub) | fill in the columns |
| Factory | `keel make:factory User` | reference the model |
| Seeder | `keel make:seeder Database` | call factories in `run()` |
| Job | `keel make:job SendWelcome` | `dispatch(new SendWelcomeJob())` |
| Notification | `keel make:notification Paid` | `notify(user, new PaidNotification())` |
| Transformer | `keel make:transformer User` | return it from a controller |
| Package | `keel make:package billing` | a `PackageProvider` — see [`docs/packages.md`](./docs/packages.md) |

**Scaffolding does not write files** via MCP — it returns code + path; you write
it. The console (`keel make:*`) does write, and refuses to overwrite.

A minimal controller and route:

```ts
// app/Controllers/PostController.ts
import type { Ctx } from "@shaferllc/keel/core";
export class PostController {
  index(c: Ctx) { return c.json({ ok: true }); }
}

// routes/web.ts
router.get("/posts", [PostController, "index"]).name("posts.index");
```

## Commands

```bash
npm run dev            # example app on http://localhost:3000 (tsx watch)
npm run serve          # keel serve
npm run keel -- routes # list registered routes
npm run keel -- migrate # run pending app + package migrations (also migrate:status, migrate:rollback)
npm run keel -- migrate:fresh --seed # drop every table, migrate, seed (also migrate:reset, migrate:refresh)
npm run keel -- db:seed # run database/seeders/DatabaseSeeder.ts (-c <Class> for another)
npm run keel -- search:index Post # rebuild a model's search index (also search:flush)
npm run keel -- queue:work --once # drain due jobs (also queue:failed, queue:retry, queue:flush)
npm run keel -- make:controller Foo
npm run mcp            # start the MCP server over stdio (dev)
npm test               # node --test over tests/*.test.ts
npm run typecheck      # tsc --noEmit — run before you finish
npm run build          # regenerate AI artifacts + compile to dist/
npm run build:ai       # regenerate llms.txt, llms-full.txt, docs/ai-manifest.json
```

## Conventions & guardrails

- **TypeScript, strict, ESM.** `.js` extensions in relative imports (NodeNext).
  No default exports except where the pattern already uses them (routes).
- **Match the surrounding file** — comment density, naming, idioms. Keel prizes
  legibility; write code that reads like `src/core/`.
- **Test with the real thing.** `TestClient`/`testClient` drives the HTTP stack
  in-process; `hash.fake()`, `fakeDisk()`, `ArrayTransport`, `MemoryDriver`, and
  `EventBuffer` make side-effecting subsystems deterministic. See
  [`docs/testing.md`](./docs/testing.md).
- **Run `npm run typecheck` before finishing.** The whole framework is typed end
  to end; a green `tsc` is the bar.
- **After editing docs or the export surface, run `npm run build:ai`** so
  `llms.txt`, `llms-full.txt`, and `docs/ai-manifest.json` stay in sync (the MCP
  server reads the manifest).

## MCP server (recommended)

Keel ships an MCP server exposing its docs, the full public API surface, the
generators, and framework conventions to any MCP-capable agent.

```bash
curl -fsSL https://keeljs.com/install.sh | bash
# or:
npx -y keel-mcp@latest init          # writes .mcp.json in the current project
npx -y keel-mcp@latest init --all    # + .cursor/mcp.json + Claude Code
```

**Claude Code:**
```bash
claude mcp add keel -- npx -y --package=@shaferllc/keel keel-mcp
```
Or, hacking on the framework itself:
```bash
claude mcp add keel -- npm --prefix /path/to/keel run mcp
```

**`.mcp.json` / Cursor / other clients** (same as `init`):
```json
{ "mcpServers": { "keel": { "command": "npx", "args": ["-y", "--package=@shaferllc/keel", "keel-mcp"] } } }
```

Tools: `keel_overview`, `keel_search_docs`, `keel_read_doc`, `keel_search_api`,
`keel_list_generators`, `keel_scaffold`. Resources: `keel://overview`,
`keel://llms-full`, `keel://docs/<slug>`. See [`docs/ai.md`](./docs/ai.md).

## Where to read next

- [`docs/getting-started.md`](./docs/getting-started.md) — a guided first hour
- [`docs/architecture.md`](./docs/architecture.md) — a request from socket to response
- [`docs/container.md`](./docs/container.md) — the DI core everything rests on
- [`docs/ui.md`](./docs/ui.md) — design kit (`@shaferllc/keel/ui`) for JSX views
- [`llms-full.txt`](./llms-full.txt) — every guide in one file, for a fresh context

## Learned User Preferences

- Do not reference peer frameworks (Fastify, Laravel, Koa, etc.) in docs, comments, changelogs, or marketing; keep Hono as the only named HTTP foundation.

## Learned Workspace Facts

- Keel Cloud (control plane) lives in the sibling `keel-cloud` repo, not inside this framework repo; this package supplies `@shaferllc/keel/gates`, `@shaferllc/keel/hosting`, and MCP `keel_cloud_*` tools that call Cloud’s API.
- `create-keeljs` plus self-managed Cloudflare and optional Keel Cloud hosting are alternative paths — do not mix both for the same app; see [`docs/from-install-to-deploy.md`](./docs/from-install-to-deploy.md).
- Cloud MCP tools register when `KEEL_CLOUD_TOKEN` is set (optional `KEEL_CLOUD_URL`, production default `https://app.keeljs.cloud`).
