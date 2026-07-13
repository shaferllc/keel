# Building Keel apps with AI

Keel is built to be **written with an AI agent**. This page is the map of the
AI-facing surface: an MCP server, machine-readable docs (`llms.txt` /
`llms-full.txt`), an agent playbook (`AGENTS.md`), and code generators an agent
can drive directly.

If you only read one thing: follow
[From install to deploy](./from-install-to-deploy.md). To **deploy on
`*.keeljs.cloud` from your IDE**, see [Keel Cloud (deploy from MCP)](./keel-cloud.md).
Then point your agent at the [MCP server](#the-mcp-server) and call
`keel_overview` first.

## Why this exists

An agent working in a Keel app needs three things: to know the **conventions**
(where things live, what imports to use), to **look up APIs and guides** without
hallucinating, and to **generate correct boilerplate**. Keel provides each as a
first-class, always-current surface — generated from the same source as the
human docs, so they never drift.

## The MCP server

Keel ships an [MCP](https://modelcontextprotocol.io) server that exposes its
documentation, the full public API surface (380+ exports), the generators, and
its conventions to any MCP-capable client.

### Connect it

Easiest — curl this in your app (or any folder you want the config):

```bash
curl -fsSL https://raw.githubusercontent.com/shaferllc/keel/main/scripts/install-mcp.sh | bash
```

Or via npx:

```bash
npx -y keel-mcp@latest init
```

Both write a merge-safe `.mcp.json`. Add `--all` for `.cursor/mcp.json` plus
Claude Code registration, or `--token keel_….…` to bake in Cloud credentials
(`bash -s -- --all` when using curl).

**Claude Code** only:

```bash
claude mcp add keel -- npx -y keel-mcp
# or:
npx -y keel-mcp@latest init --claude
```

Hacking on the framework repo itself:

```bash
claude mcp add keel -- npm --prefix /path/to/keel run mcp
```

**`.mcp.json`, Cursor, Windsurf, or any client** that reads the standard config
(what `init` / `install-mcp.sh` writes):

```json
{
  "mcpServers": {
    "keel": { "command": "npx", "args": ["-y", "keel-mcp"] }
  }
}
```

The server speaks over stdio and prints its banner to **stderr** (stdout is the
protocol channel). It resolves docs from the installed `@shaferllc/keel`
package, so it always matches your installed version.

### Tools

| Tool | What it does |
|------|--------------|
| `keel_overview` | Version, conventions, folder layout, every doc topic, and the generators. **Call this first.** |
| `keel_search_docs` | Full-text search across all guides; returns snippets + slugs. |
| `keel_read_doc` | A full guide by slug, optionally with its runnable example appended. |
| `keel_search_api` | Search the public export surface; returns each symbol's module and its guide. |
| `keel_list_generators` | The `keel make:*` generators, what they produce, and their flags. |
| `keel_scaffold` | Generate a controller/provider/middleware/factory/seeder/job/notification/transformer stub. Returns code + target path — it does **not** write to disk. |

When `KEEL_CLOUD_TOKEN` (and optional `KEEL_CLOUD_URL`) is set, Cloud tools are
also registered — **create, preview, and publish sites on `*.keeljs.cloud`** from
the same MCP server. Step-by-step:
**[Keel Cloud (deploy from MCP)](./keel-cloud.md)**.

Create a token at `/tokens` on [app.keeljs.cloud](https://app.keeljs.cloud) — the
plaintext looks like `keel_<selector>.<verifier>`.

| Tool | What it does |
|------|--------------|
| `keel_cloud_me` | Authenticated Cloud user (plan, site limit, team) |
| `keel_cloud_billing` | Team plan / limits / owner flag |
| `keel_cloud_billing_checkout` / `_portal` | Stripe Checkout or Customer Portal URL (owner) |
| `keel_cloud_list_sites` / `keel_cloud_get_site` | List or fetch a site (`storage_path`, hostnames, git) |
| `keel_cloud_create_site` | Create from preset (`minimal` \| `api` \| `app` \| `saas`) |
| `keel_cloud_delete_site` / `keel_cloud_restore_site` | Soft-delete (confirm) / restore |
| `keel_cloud_preview` | Deploy preview Worker |
| `keel_cloud_publish` | Publish production — requires `confirm: true` |
| `keel_cloud_deploys` | Deploy history + logs |
| `keel_cloud_list_secrets` / `keel_cloud_set_secret` / `keel_cloud_delete_secret` | Vault keys (values never returned) |
| `keel_cloud_set_custom_domain` / `keel_cloud_clear_custom_domain` | Pro custom hostname (+ optional attach) |
| `keel_cloud_export` / `keel_cloud_export_sql` | Export manifest / portable `.sql` dump |

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

The token binds to the user's **first team**. Switch teams in the dashboard before
minting a token if you need a different team context.
### Resources

- `keel://overview` — the same orientation text as `keel_overview`
- `keel://llms-full` — every guide concatenated (drop into a fresh context)
- `keel://docs/<slug>` — one resource per guide (e.g. `keel://docs/routing`)

### A typical agent loop

1. `keel_overview` → learn the conventions and topic list.
2. `keel_search_docs { query: "belongsToMany pivot" }` → find the right guide.
3. `keel_read_doc { slug: "models", include_example: true }` → read it in full.
4. `keel_scaffold { kind: "controller", name: "Post", resource: true }` → get the stub.
5. Write the file, add the route, run `npm run typecheck`.

### A typical Keel Cloud loop

Full walkthrough: [Keel Cloud (deploy from MCP)](./keel-cloud.md).

1. `keel_cloud_create_site { name: "Acme", preset: "app" }`
2. Edit the returned `storage_path` (real Keel app + git)
3. `keel_cloud_set_secret` for env the Worker needs
4. `keel_cloud_preview { site_id }` → `preview-{slug}.keeljs.cloud`
5. `keel_cloud_publish { site_id, confirm: true }` → `{slug}.keeljs.cloud`
6. Optional Pro: `keel_cloud_set_custom_domain { hostname, attach: true }`
7. Escape hatch anytime: `keel_cloud_export` + `keel_cloud_export_sql`

## `llms.txt` and `llms-full.txt`

At the package root:

- **[`llms.txt`](../llms.txt)** — the [llms.txt-spec](https://llmstxt.org) index:
  a titled, summarized, linked list of every guide and example. Good for AI
  crawlers and "add this URL as context" flows.
- **[`llms-full.txt`](../llms-full.txt)** — every guide concatenated into one
  file (~17k lines), ordered from getting-started outward. Paste it into a fresh
  context window when you want the agent to have all of Keel at once.

Both are generated by `npm run build:ai` from `docs/` and shipped in the npm
package, so they're available at `node_modules/@shaferllc/keel/llms-full.txt`.

## `AGENTS.md`

[`AGENTS.md`](../AGENTS.md) at the repo root is the agent playbook: the one
import rule, the folder map, the container/provider mental model, a "how to add
X" table, the commands, and the guardrails (typecheck before finishing, rerun
`build:ai` after doc changes). It follows the emerging cross-tool `AGENTS.md`
convention and is shipped in the package. `CLAUDE.md` points to it.

## Generators

Everything scaffoldable is available three ways, all emitting the same stubs:

- **MCP:** `keel_scaffold` (returns code; you write it)
- **Console:** `keel make:controller Post -r` (writes the file, won't overwrite)
- **By hand:** copy from `keel_read_doc` examples

See [the console guide](./console.md) for the full command list.

## Keeping it current

The AI surface is generated, not hand-maintained:

```bash
npm run build:ai   # regenerates llms.txt, llms-full.txt, docs/ai-manifest.json
```

`npm run build` runs it automatically before compiling. After you add or edit a
doc, or change the public exports in `src/core/index.ts`, run `build:ai` so the
manifest the MCP server reads stays in sync. `docs/ai-manifest.json` is the
single machine-readable index (docs + API + generators); treat it as generated
output.

## See also

- [Getting Started](./getting-started.md) — the human first-hour guide
- [Architecture](./architecture.md) — how a request flows through Keel
- [The Console](./console.md) — the `keel` command and generators
