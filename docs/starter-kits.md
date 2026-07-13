# Starter kits

```bash
npm create keeljs@latest my-app -- --preset saas
```

Four curated applications. Each is a complete, working app — not a scaffold you have
to finish. For the full path from this command through Cloudflare or Keel Cloud,
see [From install to deploy](./from-install-to-deploy.md).

| Preset | What you get |
| --- | --- |
| `minimal` | Routes, a controller, a JSX view, Tailwind. No database. |
| `api` | JSON only — models, migrations, validation, tests. No views. |
| `app` *(default)* | Full-stack: views, sessions, register/login, password reset, two-factor. |
| `saas` | `app` plus teams, roles, invitations, billing, and multi-tenancy. |

## Pick a kit

```bash
npm create keeljs@latest my-app                 # app (default)
npm create keeljs@latest my-api  -- --preset api
npm create keeljs@latest my-saas -- --preset saas
npm create keeljs@latest bare    -- --preset minimal
cd my-app && npm install && npm run dev
```

Then open `http://localhost:3000`. The SaaS kit already has a team switcher,
invites, and a billing stub wired through [teams](./teams.md) and
[billing](./billing.md) — start by editing `app/Models` and `routes/web.ts`.

## Every database, Cloudflare first

Each kit ships with all four drivers wired. Switching is `DB_CONNECTION` and nothing
else — no model or query changes, because they talk to a `Connection`, not a driver.

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
once, rather than being copy-pasted into each new app. `saas` also mounts
[teams](./teams.md) and [billing](./billing.md).

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
