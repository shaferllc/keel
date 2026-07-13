# Starter kits

```bash
npm create keeljs@latest my-app -- --preset saas
```

Four curated applications. Each is a complete, working app — not a scaffold you have
to finish. For the full path from this command through Cloudflare or Keel Cloud,
see [From install to deploy](./from-install-to-deploy.md).

| Preset | What you get |
| --- | --- |
| `minimal` | Routes, a controller, JSX + [Keel UI](./ui.md) + Tailwind, `/health`. No database. |
| `api` | JSON API via `apiResource`, OpenAPI at `/docs`, Watch at `/watch`, migrations, tests. |
| `app` *(default)* | Full-stack auth: register/login, password reset form, email verification, 2FA setup + confirm, Watch. |
| `saas` | `app` plus teams, role gates, invitation revoke, Stripe-ready **team** billing (pricing / checkout / portal), FakeGateway when Stripe keys are absent. |

UI chrome (buttons, fields, panels, hero) comes from `@shaferllc/keel/ui` — see
[UI](./ui.md). Kits import the stylesheet in `resources/css/app.css` and use the
JSX components in `resources/views/`.

Edge deploy is **cross-cutting** — every DB kit ships `worker.ts` + Wrangler. There is
no separate `edge` preset.

## Pick a kit

```bash
npm create keeljs@latest my-app                 # app (default)
npm create keeljs@latest my-api  -- --preset api
npm create keeljs@latest my-saas -- --preset saas
npm create keeljs@latest bare    -- --preset minimal
cd my-app && npm install && npm run dev
```

Then open `http://localhost:3000`. The SaaS kit already has a team switcher,
invites, role-gated admin actions, and team billing wired through [teams](./teams.md)
and [billing](./billing.md) — start by editing `app/Models` and `routes/web.ts`.

## Refreshing an existing kit

`create-keeljs` writes `.keel/kit.json` with content hashes of every stock file.
After you bump `@shaferllc/keel`, pull new kit files without clobbering your edits:

```bash
npm install @shaferllc/keel@latest
npx keel kit:sync                 # uses preset from .keel/kit.json
# npx keel kit:sync --preset saas # if you have no lockfile yet
# npx keel kit:sync --force       # overwrite customized kit files too
# npx keel kit:sync --dry-run     # preview
```

- **Missing** kit files are always added (new views, configs, …).
- **Untouched** files (hash still matches the lockfile) are updated in place.
- **Customized** files are skipped unless you pass `--force`.
- `.env` is never overwritten.

Apps generated before kit lockfiles existed: pass `--preset` once; sync writes
`.keel/kit.json` so later runs are smart. Without `--force`, only missing files
are added until the lockfile knows what "stock" looked like.

## Every database, Cloudflare first

Each kit with a database ships with all four drivers wired. Switching is
`DB_CONNECTION` and nothing else — no model or query changes, because they talk to
a `Connection`, not a driver.

| | |
| --- | --- |
| **D1** | The default for deploys. Inside the Worker Keel uses the binding; migrations and scripts reach the same database over [the HTTP API](./database.md), so `keel migrate` works from your laptop and from CI. |
| **SQLite** (libSQL) | A local file. What `npm run dev` uses — no account, no wrangler. |
| **Turso** | libSQL over the network. |
| **Postgres** | For when you want it. |

Local and production are both SQLite dialects, so one schema and one set of
migrations serve both.

```bash
npm run dev            # Node, SQLite file, no setup
npm run dev:edge       # wrangler, local D1
npm run deploy         # wrangler deploy
```

To deploy:

```bash
wrangler d1 create my-app     # paste the id into wrangler.jsonc
npm run deploy
```

## What's in the box

`app` and `saas` mount [accounts](./accounts.md), so password reset, email
verification, and two-factor already work — the flows live in the framework, tested
once, rather than being copy-pasted into each new app. HTML controllers own the UI;
JSON `/auth/*` routes are disabled via `config/accounts.ts`.

`api` mounts [`apiResource`](./api-resources.md) and [OpenAPI](./openapi.md) so the
posts demo is declarative CRUD with a live `/docs` UI. `api`, `app`, and `saas` also
mount [Watch](./watch.md) at `/watch` for local debugging.

`saas` also mounts [teams](./teams.md) and [billing](./billing.md). The **team** is
the Stripe customer (`billableTable: "teams"`). Without Stripe keys, FakeGateway
runs so subscribe still redirects to a checkout URL in development and tests.

In `saas`, a tenant-owned model is one word:

```ts
import { TenantModel } from "@shaferllc/keel/teams";

class Project extends TenantModel {
  static table = "projects";
}

await Project.all();                  // only the current team's. Always.
await Project.create({ name: "Hi" }); // stamped with the current team
```

Another team's project isn't merely hidden from a list — `Project.find(id)` returns
`null`. You never write `.where("team_id", …)`, which is what makes it impossible to
forget.

## Why a generator, and not a template repo

Because a second repo rots. The old starter sat pinned to `0.78.2` while the
framework was on `0.79.0`, and nothing noticed.

The templates live **inside the framework package**, so the version a kit is
generated from is, by construction, the version it was written for. And CI generates
all four on every push, then typechecks, migrates, boots, serves a request, bundles
the Worker, and runs their tests — so a breaking change fails in the pull request
that caused it, not in your `npm create` three weeks later.

## The Node/edge seam

Each kit has two provider lists. `bootstrap/providers.ts` runs under Node;
`bootstrap/providers.edge.ts` runs in the Worker and deliberately **omits the
database provider** — it reaches for `pg`, which needs `net`/`tls`, and wrangler
cannot bundle a TCP driver for the edge. `worker.ts` binds D1 before the app boots,
so nothing on the edge needs to open a connection.

If you add a provider that touches a Node-only module, add it to the Node list only.
