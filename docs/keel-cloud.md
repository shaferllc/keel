# Keel Cloud (deploy from MCP)

**Keel Cloud** hosts your Keel apps on `*.keeljs.cloud` — preview and production
Workers, D1, secrets vault, and full export (git + SQL). You build in your IDE
with an AI agent; the same `keel-mcp` binary that knows the framework also
**creates sites and deploys them** when you set a Cloud token.

| Host | Role |
|------|------|
| [app.keeljs.cloud](https://app.keeljs.cloud) | Control plane (dashboard + `/api/v1`) |
| `preview-{slug}.keeljs.cloud` | Preview Worker |
| `{slug}.keeljs.cloud` | Production Worker |
| [keeljs.com](https://keeljs.com) | Framework docs (this site) |

Private alpha: registration needs an invite code or allowlisted email. Free tier
is limited (typically one site); Pro adds more sites and custom domains.

> Prefer owning Cloudflare yourself? Use
> [From install to deploy](./from-install-to-deploy.md) §4 (`create-keeljs` +
> `wrangler deploy`). Cloud and self-host are **alternate** paths — don’t mix
> them for the same app.

## Why deploy from MCP

Agents already use `keel-mcp` for docs and scaffolding. With a token they also
get `keel_cloud_*` tools against the control plane — no separate CLI, no
copy-pasting wrangler credentials into the agent. The loop is:

```text
create_site → edit storage_path → set_secret → preview → publish (confirm)
```

## 1. Sign up and mint a token

1. Open [app.keeljs.cloud](https://app.keeljs.cloud) and register (invite /
   allowlist during alpha).
2. Go to **`/tokens`** → create a personal access token.
3. Copy the plaintext once — it looks like `keel_<selector>.<verifier>`.

The token binds to your **first team**. Switch teams in the dashboard before
minting if you need a different team context.

## 2. Wire `keel-mcp` for Cloud

Same server as local docs/API — add env so Cloud tools register:

**Cursor / `.mcp.json` / Windsurf:**

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

**Claude Code:**

```bash
claude mcp add keel -e KEEL_CLOUD_TOKEN=keel_….… -e KEEL_CLOUD_URL=https://app.keeljs.cloud -- npx -y keel-mcp
```

Reload the MCP client. Stderr should say `Cloud tools enabled`. Call
`keel_overview` — it lists the Cloud loop when a token is present.

Local-only (docs + scaffold, no deploy): omit the env vars.
[Building with AI](./ai.md) covers that surface.

## 3. Deploy a site from the agent

Tell your agent something like: *“Create an app preset site named Acme on Keel
Cloud, then preview it.”* Or drive the tools yourself:

### Create

```text
keel_cloud_create_site { "name": "Acme", "preset": "app" }
```

Presets: `minimal` | `api` | `app` | `saas` (same kits as
[`create-keeljs`](./starter-kits.md)).

Response includes `storage_path` (real Keel app on disk) and hostnames. Open that
path in your IDE and edit like any Keel project.

### Secrets (optional, before deploy)

```text
keel_cloud_set_secret { "site_id": 1, "key": "STRIPE_SECRET_KEY", "value": "sk_…" }
keel_cloud_list_secrets { "site_id": 1 }    # keys only — values never returned
```

Secrets are vaulted (not in git) and injected on the next preview/publish.

### Preview (safe to repeat)

```text
keel_cloud_preview { "site_id": 1 }
```

Deploys the preview Worker → `preview-{slug}.keeljs.cloud`. Iterate freely.

### Publish production (confirm required)

```text
keel_cloud_publish { "site_id": 1, "confirm": true }
```

Agents must get your explicit approval before `confirm: true`. Production lands
on `{slug}.keeljs.cloud`.

### Check status

```text
keel_cloud_get_site { "site_id": 1 }
keel_cloud_deploys { "site_id": 1 }       # logs + preview/production history
keel_cloud_me                             # plan, site_limit, team
```

### Custom domain (Pro)

```text
keel_cloud_set_custom_domain {
  "site_id": 1,
  "hostname": "app.example.com",
  "attach": true
}
```

Returns CNAME instructions (point at `{slug}.keeljs.cloud`). The customer zone
must live on the same Cloudflare account as Keel Cloud. Clear with
`keel_cloud_clear_custom_domain`.

### Escape hatch

```text
keel_cloud_export { "site_id": 1 }
keel_cloud_export_sql { "site_id": 1, "env": "production" }
```

Always yours: clone `storage_path` / `git_url`, restore the `.sql` dump on a
self-hosted Keel app anytime.

## Tool cheat sheet

| Tool | Deploy role |
|------|-------------|
| `keel_cloud_create_site` | Scaffold kit under Cloud storage |
| `keel_cloud_preview` | Deploy preview Worker |
| `keel_cloud_publish` | Deploy production (`confirm: true`) |
| `keel_cloud_set_secret` / `_list_secrets` / `_delete_secret` | Runtime env for Workers |
| `keel_cloud_set_custom_domain` / `_clear_custom_domain` | Pro hostname |
| `keel_cloud_deploys` / `_get_site` | Status and logs |
| `keel_cloud_billing` / `_checkout` / `_portal` | Plan / upgrade (owner) |
| `keel_cloud_export` / `_export_sql` | Leave with code + data |
| `keel_cloud_delete_site` / `_restore_site` | Soft-delete / restore |

Full API table and local-docs tools: [Building with AI](./ai.md).

## Dashboard parity

Everything above is also available in the browser at
[app.keeljs.cloud](https://app.keeljs.cloud) (`/sites`, `/billing`, `/tokens`).
MCP is the agent-first path; the UI is the same control plane.

## Related

- [From install to deploy](./from-install-to-deploy.md) — full journey including
  self-hosted Cloudflare
- [Building with AI](./ai.md) — MCP docs + complete `keel_cloud_*` list
- [Starter kits](./starter-kits.md) — what each preset contains
- [Hosting](./hosting.md) — primitives Cloud uses under the hood
- [Gates](./gates.md) — invite / allowlist signup gating
