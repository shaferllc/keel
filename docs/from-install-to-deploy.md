# From install to deploy

One path from zero to a live Keel app — locally, on Cloudflare yourself, or on
**Keel Cloud** with an AI agent. Pick the track that matches how you want to
ship; everything else is optional.

```text
  create-keeljs  →  npm run dev  →  (optional MCP)  →  deploy
                                              ↘
                                         Keel Cloud (optional)
```

## Requirements

- Node.js **≥ 22**
- npm
- For self-hosted edge deploys: a [Cloudflare](https://dash.cloudflare.com) account
  and [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (ships with
  the kits as a devDependency)
- For Keel Cloud: an invite / allowlisted email at [app.keeljs.cloud](https://app.keeljs.cloud)
  during private alpha

## 1. Create an app

```bash
npm create keeljs@latest my-app                 # full-stack "app" preset (default)
# npm create keeljs@latest my-api  -- --preset api
# npm create keeljs@latest my-saas -- --preset saas
# npm create keeljs@latest bare    -- --preset minimal
cd my-app
npm install
cp .env.example .env                            # if the kit didn't already
```

| Preset | Use when |
|--------|----------|
| `minimal` | Hello-world / learning — routes, a view, Tailwind. No database. |
| `api` | JSON API — models, migrations, token auth, OpenAPI, tests. |
| `app` *(default)* | Product with views, sessions, register/login, password reset, 2FA. |
| `saas` | Multi-tenant product — teams, roles, invitations, billing. |

Templates live **inside** `@shaferllc/keel`, so the kit version matches the
framework version you just installed. Details: [Starter kits](./starter-kits.md).

## 2. Run it locally

```bash
npm run migrate          # if the preset has a database (api / app / saas)
npm run dev              # http://localhost:3000 — Node + local SQLite
```

Useful next commands:

```bash
npm run keel -- routes                 # what is mounted
npm run keel -- make:controller Post   # scaffold, then wire a route
npm test
npm run typecheck
```

Local tip: `DB_CONNECTION` defaults to a SQLite file. Switching drivers later is
config only — see [Database](./database.md) and [Starter kits](./starter-kits.md).

For a guided first hour inside the codebase (routes, controllers, views, config),
read [Getting Started](./getting-started.md).

## 3. Optional — AI agents (local)

Keel is designed to be written with an agent. Point Cursor / Claude Code at the
MCP server that ships with the package:

```json
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "keel-mcp"]
    }
  }
}
```

Then have the agent call `keel_overview` first. It can search docs, look up the
public API, and scaffold controllers/jobs/… without inventing imports.

Full map: [Building with AI](./ai.md).

## 4. Deploy yourself (Cloudflare Workers)

Every kit includes `wrangler.jsonc`, a `worker.ts` entry, and `npm run deploy`.
You own the Cloudflare account and the hostname.

```bash
# one-time
npx wrangler login
npx wrangler d1 create my-app          # paste database_id into wrangler.jsonc

# ship
npm run deploy                         # css:build + wrangler deploy
```

Migrations against remote D1 use the HTTP driver from your laptop / CI — the
binding only exists inside the Worker. Set Cloudflare API credentials as
documented in [Database](./database.md) (D1 HTTP) and your kit’s README.

Edge preview without deploying:

```bash
npm run dev:edge                       # wrangler + local D1
```

Hosting helpers (hostname utils, SQL dump, secrets encryption) live in
[`@shaferllc/keel/hosting`](./hosting.md) if you build your own control plane.

## 5. Optional — Keel Cloud

[Keel Cloud](https://app.keeljs.cloud) is a hosted control plane: pick a preset,
edit real source, preview and publish Workers for you, vault secrets, and export
git + SQL anytime. Free tier is limited (typically one site); Pro adds more sites
and custom domains.

Use Cloud when you want the platform to own deploys and hostnames. Skip it when
you already have Cloudflare / your own pipeline (§4).

### Sign up and mint a token

1. Open [app.keeljs.cloud](https://app.keeljs.cloud) (invite code or allowlisted
   email during alpha).
2. Create a personal access token at **`/tokens`**. The plaintext looks like
   `keel_<selector>.<verifier>` — copy it once.
3. Wire it into your MCP client (same `keel-mcp` binary as local):

```json
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "keel-mcp"],
      "env": {
        "KEEL_CLOUD_TOKEN": "keel_….…",
        "KEEL_CLOUD_URL": "https://app.keeljs.cloud"
      }
    }
  }
}
```

Reload MCP. When the token is set, `keel_cloud_*` tools appear alongside the
docs tools. The token binds to your **first team**.

### Agent loop on Cloud

1. `keel_cloud_create_site { name: "Acme", preset: "app" }`
2. Edit files at the returned `storage_path` (real Keel app + git)
3. `keel_cloud_set_secret` for anything the Worker needs at runtime
4. `keel_cloud_preview { site_id }` — iterate freely
5. `keel_cloud_publish { site_id, confirm: true }` — only after you approve
6. Optional Pro: `keel_cloud_set_custom_domain { hostname, attach: true }`
7. Escape hatch anytime: `keel_cloud_export` + `keel_cloud_export_sql`

You can also drive the same flow from the dashboard at `/sites`. Billing for Pro
is at `/billing` (or `keel_cloud_billing` / `_checkout` / `_portal` via MCP).

Tool reference: [Building with AI](./ai.md#the-mcp-server).

## Which path should I pick?

| Goal | Path |
|------|------|
| Learn Keel / ship a side project on your CF account | §§1–4 |
| Build with an agent in your IDE, deploy yourself | §§1–4 + §3 |
| Let the platform host preview/prod + secrets + export | §§1–2 + §5 (Cloud creates the app for you) |
| Multi-tenant SaaS with billing | Preset `saas`, then §4 or §5 |

Cloud **create_site** scaffolds a kit the same way `create-keeljs` does — you do
not need both for the same app. Use `create-keeljs` for apps you own end-to-end;
use Cloud when you want hosted preview/publish under `*.keeljs.cloud`.

## Where next

- [Getting Started](./getting-started.md) — first route, controller, view
- [Starter kits](./starter-kits.md) — presets and the Node/edge seam
- [Building with AI](./ai.md) — MCP tools (local + Cloud)
- [Hosting](./hosting.md) — Cloudflare / dump / secrets primitives
- [Accounts](./accounts.md) · [Teams](./teams.md) · [Billing](./billing.md) — what
  `app` / `saas` already mount
