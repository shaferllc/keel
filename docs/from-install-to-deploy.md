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

Keel is designed to be written with an agent. Install the MCP server config in
whatever project you're in:

```bash
curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash
```

Same thing via npx:

```bash
npx -y keel-mcp@latest init
```

Flags (work with either command — pass after `bash -s --` for curl):

```bash
curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash -s -- --all
npx -y keel-mcp@latest init --all              # .cursor/mcp.json + Claude Code
npx -y keel-mcp@latest init --claude
npx -y keel-mcp@latest init --token "$KEEL_CLOUD_TOKEN"
```

That writes a merge-safe `.mcp.json`. Or paste by hand:

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

## 5. Optional — Keel Cloud (`*.keeljs.cloud`)

Ship without owning a Cloudflare account: **Keel Cloud** creates the site,
runs preview/production Workers on `*.keeljs.cloud`, vaults secrets, and lets
you export git + SQL anytime — driven from the **same `keel-mcp`** you already
use for docs.

**Dedicated guide:** [Keel Cloud (deploy from MCP)](./keel-cloud.md).

Quick path:

1. Sign up at [app.keeljs.cloud](https://app.keeljs.cloud) → mint a token at `/tokens`
2. Add `KEEL_CLOUD_TOKEN` (+ `KEEL_CLOUD_URL`) to your MCP config
3. Agent: `keel_cloud_create_site` → edit `storage_path` → `keel_cloud_preview` →
   `keel_cloud_publish { confirm: true }`

Use Cloud when you want the platform to own deploys and hostnames. Skip it when
you already have Cloudflare / your own pipeline (§4). Don’t mix Cloud and
self-host for the same app.

## Which path should I pick?

| Goal | Path |
|------|------|
| Learn Keel / ship a side project on your CF account | §§1–4 |
| Build with an agent in your IDE, deploy yourself | §§1–4 + §3 |
| Let the platform host preview/prod on `*.keeljs.cloud` via MCP | [Keel Cloud](./keel-cloud.md) |
| Multi-tenant SaaS with billing | Preset `saas`, then §4 or §5 |

Cloud **create_site** scaffolds a kit the same way `create-keeljs` does — you do
not need both for the same app. Use `create-keeljs` for apps you own end-to-end;
use Cloud when you want hosted preview/publish under `*.keeljs.cloud`.

## Where next

- [Keel Cloud (deploy from MCP)](./keel-cloud.md) — create / preview / publish
  on `*.keeljs.cloud` from `keel-mcp`
- [Getting Started](./getting-started.md) — first route, controller, view
- [Starter kits](./starter-kits.md) — presets and the Node/edge seam
- [Building with AI](./ai.md) — MCP tools (local + Cloud)
- [Hosting](./hosting.md) — Cloudflare / dump / secrets primitives
- [Accounts](./accounts.md) · [Teams](./teams.md) · [Billing](./billing.md) — what
  `app` / `saas` already mount
