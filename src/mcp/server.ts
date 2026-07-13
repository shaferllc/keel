/**
 * The Keel MCP server. Exposes Keel's documentation, public API surface, and
 * code generators to AI agents (Claude Code, Cursor, …) over stdio, so an agent
 * editing a Keel app can look things up and scaffold code without guessing.
 *
 * Run it with `keel mcp` (dev) or the shipped `keel-mcp` bin (consumers).
 * Tools:
 *   keel_overview          framework facts, conventions, folder layout
 *   keel_search_docs       full-text search across the guides
 *   keel_read_doc          a full guide (optionally with its runnable example)
 *   keel_search_api        search the public export surface
 *   keel_list_generators   the `keel make:*` generators
 *   keel_scaffold          generate a controller/provider/job/… stub (no write)
 * When KEEL_CLOUD_TOKEN is set, also:
 *   keel_cloud_*           create/list/preview/publish sites on Keel Cloud
 * Resources: keel://overview, keel://llms-full, and keel://docs/<slug> per guide.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  controllerStub,
  resourceControllerStub,
  providerStub,
  middlewareStub,
  factoryStub,
  seederStub,
  jobStub,
  notificationStub,
  transformerStub,
} from "../core/cli/stubs.js";
import { registerCloudTools } from "./cloud.js";

interface DocEntry {
  slug: string;
  title: string;
  summary: string;
  path: string;
  example: string | null;
}
interface ApiEntry {
  name: string;
  kind: "value" | "type";
  module: string;
}
interface Manifest {
  name: string;
  version: string;
  description: string;
  repo: string;
  docs: DocEntry[];
  api: ApiEntry[];
  generators: { command: string; produces: string; flags: string[]; note: string }[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from this module until we find the package root (the dir holding docs/). */
async function findRoot(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (await exists(join(dir, "docs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to two levels up (…/mcp/server.js -> package root).
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Load the generated manifest, or reconstruct a minimal one by scanning docs/. */
async function loadManifest(root: string): Promise<Manifest> {
  const manifestPath = join(root, "docs", "ai-manifest.json");
  if (await exists(manifestPath)) {
    return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  }
  // Fallback: scan docs so the server still works before `npm run build:ai`.
  const docsDir = join(root, "docs");
  const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
  const docs: DocEntry[] = [];
  for (const file of files) {
    const md = await readFile(join(docsDir, file), "utf8");
    const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    docs.push({ slug: file.replace(/\.md$/, ""), title, summary: "", path: `docs/${file}`, example: null });
  }
  let pkg = { name: "@shaferllc/keel", version: "0.0.0", description: "The house framework for Node.js." };
  try {
    pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    /* use defaults */
  }
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    repo: "https://github.com/shaferllc/keel",
    docs,
    api: [],
    generators: [],
  };
}

// ---- generators ------------------------------------------------------------

/** Normalize "foo" / "FooController" into a canonical suffixed class name. */
function className(name: string, suffix: string): string {
  const base = name.replace(new RegExp(`${suffix}$`, "i"), "");
  const pascal = base.charAt(0).toUpperCase() + base.slice(1);
  return `${pascal}${suffix}`;
}

const GENERATOR_KINDS = [
  "controller",
  "provider",
  "middleware",
  "factory",
  "seeder",
  "job",
  "notification",
  "transformer",
] as const;
type GeneratorKind = (typeof GENERATOR_KINDS)[number];

/** Build a stub for a `make:*` kind. Pure — returns the code and target path, never writes. */
function scaffold(
  kind: GeneratorKind,
  name: string,
  opts: { resource?: boolean; model?: string },
): { path: string; code: string } {
  switch (kind) {
    case "controller": {
      const cls = className(name, "Controller");
      return {
        path: `app/Controllers/${cls}.ts`,
        code: opts.resource ? resourceControllerStub(cls) : controllerStub(cls),
      };
    }
    case "provider": {
      const cls = className(name, "ServiceProvider");
      return { path: `app/Providers/${cls}.ts`, code: providerStub(cls) };
    }
    case "middleware": {
      const cls = className(name, "Middleware");
      const file = cls.charAt(0).toLowerCase() + cls.slice(1);
      return { path: `app/Http/Middleware/${file}.ts`, code: middlewareStub(cls) };
    }
    case "factory": {
      const cls = className(name, "");
      return { path: `database/factories/${cls}Factory.ts`, code: factoryStub(cls) };
    }
    case "seeder": {
      const cls = className(name, "Seeder");
      return { path: `database/seeders/${cls}.ts`, code: seederStub(cls) };
    }
    case "job": {
      const cls = className(name, "Job");
      return { path: `app/Jobs/${cls}.ts`, code: jobStub(cls) };
    }
    case "notification": {
      const cls = className(name, "Notification");
      return { path: `app/Notifications/${cls}.ts`, code: notificationStub(cls) };
    }
    case "transformer": {
      const cls = className(name, "Transformer");
      const model = opts.model ? className(opts.model, "") : cls.replace(/Transformer$/, "");
      return { path: `app/Transformers/${cls}.ts`, code: transformerStub(cls, model) };
    }
  }
}

// ---- search ----------------------------------------------------------------

function snippet(body: string, query: string): string {
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return body.slice(0, 200).replace(/\s+/g, " ").trim();
  const start = Math.max(0, idx - 80);
  const end = Math.min(body.length, idx + query.length + 120);
  return (start > 0 ? "…" : "") + body.slice(start, end).replace(/\s+/g, " ").trim() + (end < body.length ? "…" : "");
}

// ---- server ----------------------------------------------------------------

export async function createServer(): Promise<McpServer> {
  const root = await findRoot();
  const manifest = await loadManifest(root);
  const docBySlug = new Map(manifest.docs.map((d) => [d.slug, d]));
  // Which doc guide, if any, documents a given source module (e.g. "queue" -> "queues").
  const moduleToDoc = (module: string): string | undefined => {
    for (const cand of [module, `${module}s`, module.replace(/s$/, "")]) {
      if (docBySlug.has(cand)) return cand;
    }
    return undefined;
  };

  const server = new McpServer({ name: "keel", version: manifest.version });

  const overviewText = () =>
    [
      `# ${manifest.name} v${manifest.version}`,
      "",
      manifest.description,
      "",
      "Keel is a small, legible MVC framework for Node.js. Hono powers HTTP; everything",
      "above it is Keel's. Userland imports everything from `@shaferllc/keel/core`.",
      "",
      "## Conventions",
      "- Import surface: `import { Router, Model, config } from \"@shaferllc/keel/core\";`",
      "- Everything resolves through the service container (`bind`/`singleton`/`make`).",
      "- Service providers (`register()` then `boot()`) wire the app together.",
      "- Config is dot-notation: `config(\"app.name\")`, sourced from `config/*.ts` + `.env`.",
      "",
      "## Folder layout (a Keel app)",
      "- `app/Controllers`, `app/Providers`, `app/Http/Middleware`, `app/Models`, `app/Jobs`, …",
      "- `config/*.ts` — configuration files",
      "- `routes/web.ts` — route definitions (default export receives the Router)",
      "- `database/factories`, `database/seeders`, `database/migrations`",
      "- `bootstrap/app.ts` — assembles the Application and its providers",
      "",
      `## Guides (${manifest.docs.length}) — read with keel_read_doc`,
      ...manifest.docs.map((d) => `- ${d.slug}: ${d.summary || d.title}`),
      "",
      "## Generators — use keel_scaffold or `keel make:*`",
      ...manifest.generators.map((g) => `- ${g.command} → ${g.produces}`),
      ...(process.env.KEEL_CLOUD_TOKEN?.trim()
        ? [
            "",
            "## Keel Cloud (token detected)",
            "Cloud tools are enabled — deploy to *.keeljs.cloud from this MCP server.",
            "Guide: keel_read_doc { slug: \"keel-cloud\" }",
            "Typical loop:",
            "1. keel_cloud_create_site { name, preset }",
            "2. Edit files at the returned storage_path (real Keel app)",
            "3. keel_cloud_preview { site_id } → preview-{slug}.keeljs.cloud",
            "4. keel_cloud_publish { site_id, confirm: true } → {slug}.keeljs.cloud",
            "Also: secrets, custom domains (Pro), billing, export(+sql), delete/restore.",
            "Token binds to the user's first team.",
          ]
        : []),
    ].join("\n");

  // ---- tools ----
  server.registerTool(
    "keel_overview",
    {
      title: "Keel overview",
      description:
        "Start here. Returns Keel's version, conventions, folder layout, the full list of doc topics, and the available code generators. Call this first when working in a Keel app.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: overviewText() }] }),
  );

  server.registerTool(
    "keel_search_docs",
    {
      title: "Search Keel docs",
      description:
        "Full-text search across all Keel guides. Returns the best-matching guides with a snippet and slug; follow up with keel_read_doc to read one in full.",
      inputSchema: {
        query: z.string().describe("What to look for, e.g. 'rate limit middleware' or 'belongsToMany'"),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 6)"),
      },
    },
    async ({ query, limit }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const first = terms[0] ?? query.toLowerCase();
      const scored: { doc: DocEntry; score: number; body: string }[] = [];
      for (const doc of manifest.docs) {
        const body = await readFile(join(root, doc.path), "utf8");
        const hay = body.toLowerCase();
        const title = doc.title.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (title.includes(t)) score += 10;
          if (doc.slug.includes(t)) score += 8;
          const matches = hay.split(t).length - 1;
          score += Math.min(matches, 8);
        }
        if (score > 0) scored.push({ doc, score, body });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit ?? 6);
      if (top.length === 0) {
        return { content: [{ type: "text", text: `No Keel docs matched "${query}".` }] };
      }
      const text = top
        .map(
          ({ doc, body }) =>
            `## ${doc.title}  (slug: ${doc.slug})\n${snippet(body, first)}\n→ keel_read_doc { slug: "${doc.slug}" }`,
        )
        .join("\n\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "keel_read_doc",
    {
      title: "Read a Keel doc",
      description:
        "Return a full Keel guide by slug (e.g. 'routing', 'models', 'queues'). Optionally append its runnable, type-checked example. Use keel_search_docs or keel_overview to find slugs.",
      inputSchema: {
        slug: z.string().describe("Doc slug, e.g. 'routing' or 'getting-started'"),
        include_example: z.boolean().optional().describe("Append the guide's example source if it has one (default false)"),
      },
    },
    async ({ slug, include_example }) => {
      const doc = docBySlug.get(slug);
      if (!doc) {
        const near = manifest.docs
          .filter((d) => d.slug.includes(slug) || slug.includes(d.slug))
          .map((d) => d.slug);
        return {
          content: [
            {
              type: "text",
              text: `No doc "${slug}".${near.length ? ` Did you mean: ${near.join(", ")}?` : ""} Use keel_overview to list all slugs.`,
            },
          ],
          isError: true,
        };
      }
      let text = await readFile(join(root, doc.path), "utf8");
      if (include_example && doc.example && (await exists(join(root, doc.example)))) {
        const ex = await readFile(join(root, doc.example), "utf8");
        text += `\n\n---\n\n## Example — ${doc.example}\n\n\`\`\`ts\n${ex}\n\`\`\`\n`;
      }
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "keel_search_api",
    {
      title: "Search Keel's public API",
      description:
        "Search the public export surface of `@shaferllc/keel/core` (382+ symbols). Returns matching value/type exports, the source module each lives in, and the guide that documents it.",
      inputSchema: {
        query: z.string().describe("A symbol or fragment, e.g. 'Router', 'cache', 'hasMany', 'Exception'"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
      },
    },
    async ({ query, limit }) => {
      if (manifest.api.length === 0) {
        return { content: [{ type: "text", text: "API index unavailable — run `npm run build:ai`." }] };
      }
      const q = query.toLowerCase();
      const hits = manifest.api
        .map((e) => {
          const name = e.name.toLowerCase();
          let score = 0;
          if (name === q) score = 100;
          else if (name.startsWith(q)) score = 50;
          else if (name.includes(q)) score = 25;
          else if (e.module.includes(q)) score = 5;
          return { e, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
        .slice(0, limit ?? 20);
      if (hits.length === 0) {
        return { content: [{ type: "text", text: `No exports matched "${query}".` }] };
      }
      const text = hits
        .map(({ e }) => {
          const doc = moduleToDoc(e.module);
          return `- ${e.kind === "type" ? "type " : ""}${e.name}  (module: ${e.module}${doc ? `, doc: ${doc}` : ""})`;
        })
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `Import from "@shaferllc/keel/core":\n\n${text}\n\nRead a module's guide with keel_read_doc.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "keel_list_generators",
    {
      title: "List Keel generators",
      description: "List the `keel make:*` code generators, what each produces, and their flags. Use keel_scaffold to generate one.",
      inputSchema: {},
    },
    async () => {
      const text = manifest.generators
        .map((g) => `- ${g.command}\n    → ${g.produces}${g.flags.length ? `\n    flags: ${g.flags.join(", ")}` : ""}\n    ${g.note}`)
        .join("\n\n");
      return { content: [{ type: "text", text: text || "No generator metadata — run `npm run build:ai`." }] };
    },
  );

  server.registerTool(
    "keel_scaffold",
    {
      title: "Scaffold Keel code",
      description:
        "Generate the stub for a Keel construct (controller, provider, middleware, factory, seeder, job, notification, transformer) and return the code plus its target path. Does NOT write to disk — write the returned code yourself. Mirrors `keel make:*`.",
      inputSchema: {
        kind: z.enum(GENERATOR_KINDS).describe("What to generate"),
        name: z.string().describe("Base name, e.g. 'User', 'SendWelcome' — suffixes are normalized"),
        resource: z.boolean().optional().describe("controller only: scaffold all seven RESTful actions"),
        model: z.string().optional().describe("transformer only: the model it maps, e.g. 'User'"),
      },
    },
    async ({ kind, name, resource, model }) => {
      const { path, code } = scaffold(kind, name, { resource, model });
      return {
        content: [
          {
            type: "text",
            text: `Target: ${path}\n\n\`\`\`ts\n${code}\`\`\`\n\nWrite this file, then register/import it where appropriate (see keel_read_doc { slug: "${moduleToDoc(kind) ?? kind}" }).`,
          },
        ],
      };
    },
  );

  // ---- resources ----
  server.registerResource(
    "overview",
    "keel://overview",
    { title: "Keel overview", description: "Conventions, layout, topics, generators", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: overviewText() }] }),
  );

  const llmsFull = join(root, "llms-full.txt");
  if (await exists(llmsFull)) {
    server.registerResource(
      "llms-full",
      "keel://llms-full",
      { title: "All Keel docs", description: "Every guide concatenated", mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, text: await readFile(llmsFull, "utf8") }] }),
    );
  }

  for (const doc of manifest.docs) {
    server.registerResource(
      `doc:${doc.slug}`,
      `keel://docs/${doc.slug}`,
      { title: doc.title, description: doc.summary || doc.title, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, text: await readFile(join(root, doc.path), "utf8") }] }),
    );
  }

  registerCloudTools(server);

  return server;
}

/** Boot the server on stdio. Called by the `keel-mcp` bin and `keel mcp`. */
export async function runMcpServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — log to stderr only.
  const cloud = Boolean(process.env.KEEL_CLOUD_TOKEN?.trim());
  console.error(
    cloud
      ? "⚓ Keel MCP server running on stdio (Cloud tools enabled)"
      : "⚓ Keel MCP server running on stdio",
  );
}
