/**
 * Generates Keel's AI-facing artifacts from the docs and the public API surface:
 *
 *   docs/ai-manifest.json   machine-readable index the MCP server reads
 *   llms.txt                llms.txt-spec index of the docs (for AI crawlers)
 *   llms-full.txt           every doc concatenated into one file
 *
 * Run it with `npm run build:ai` after editing docs or the export surface.
 * The outputs are committed and shipped in the npm package, so the MCP server
 * and AI crawlers work against a real install without a build step.
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const examplesDir = join(docsDir, "examples");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const REPO = "https://github.com/shaferllc/keel/blob/main";

/** Doc slugs that aren't part of the topical reference (skip in llms.txt lists
 * and the concatenated llms-full.txt, but still indexed in the manifest and
 * rendered by the docs site). */
const NON_TOPIC = new Set<string>(["changelog"]);

export interface DocEntry {
  slug: string;
  title: string;
  summary: string;
  path: string;
  example: string | null;
}

export interface ApiEntry {
  name: string;
  kind: "value" | "type";
  module: string;
}

/** First non-empty paragraph after the H1, flattened to a single sentence-ish line. */
function leadSummary(md: string): string {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("# ")) i++;
  i++; // skip the H1
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i].trim();
    if (para.length === 0 && line === "") {
      i++;
      continue;
    }
    if (line === "") break;
    if (line.startsWith("#") || line.startsWith("```") || line.startsWith("|")) break;
    para.push(line);
    i++;
  }
  let text = para
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip md links, keep text
    .replace(/[*`_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Trim to the first sentence if the paragraph is long.
  const stop = text.indexOf(". ");
  if (stop > 40 && stop < text.length - 2) text = text.slice(0, stop + 1);
  return text;
}

function titleOf(md: string, slug: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : slug;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Match a doc slug to an example file, allowing the singular/plural drift in the repo. */
async function exampleFor(slug: string): Promise<string | null> {
  const candidates = [`${slug}.ts`, `${slug}.tsx`, `${slug.replace(/s$/, "")}.ts`];
  for (const c of candidates) {
    if (await exists(join(examplesDir, c))) return `docs/examples/${c}`;
  }
  return null;
}

async function collectDocs(): Promise<DocEntry[]> {
  const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
  const docs: DocEntry[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const md = await readFile(join(docsDir, file), "utf8");
    docs.push({
      slug,
      title: titleOf(md, slug),
      summary: leadSummary(md),
      path: `docs/${file}`,
      example: await exampleFor(slug),
    });
  }
  return docs;
}

/**
 * Parse the public export surface from src/core/index.ts. We read names, not
 * types — enough to answer "what can I import, and which module owns it?".
 */
async function collectApi(): Promise<ApiEntry[]> {
  const src = await readFile(join(root, "src/core/index.ts"), "utf8");
  const api: ApiEntry[] = [];
  const seen = new Set<string>();
  // export [type] { a, b as c } from "./module.js";
  const re = /export\s+(type\s+)?\{([^}]*)\}\s+from\s+["']\.\/([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const isType = Boolean(m[1]);
    const module = m[3].replace(/\.js$/, "");
    for (const raw of m[2].split(",")) {
      const part = raw.trim();
      if (!part) continue;
      // handle "Foo as Bar" — expose the exported (Bar) name
      const name = (part.split(/\s+as\s+/).pop() as string).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      api.push({ name, kind: isType ? "type" : "value", module });
    }
  }
  return api.sort((a, b) => a.name.localeCompare(b.name));
}

const GENERATORS = [
  { command: "make:controller <name>", produces: "app/Controllers/<Name>Controller.ts", flags: ["-r, --resource"], note: "A controller class resolved from the container. `-r` scaffolds all seven RESTful actions." },
  { command: "make:provider <name>", produces: "app/Providers/<Name>ServiceProvider.ts", flags: [], note: "A service provider with register()/boot() lifecycle hooks." },
  { command: "make:middleware <name>", produces: "app/Http/Middleware/<name>.ts", flags: [], note: "A Hono middleware handler (before/after next())." },
  { command: "make:factory <model>", produces: "database/factories/<Model>Factory.ts", flags: [], note: "A model factory for seeding/testing." },
  { command: "make:seeder <name>", produces: "database/seeders/<Name>Seeder.ts", flags: [], note: "A database seeder with an async run()." },
  { command: "make:job <name>", produces: "app/Jobs/<Name>Job.ts", flags: [], note: "A queued job with an async handle()." },
  { command: "make:notification <name>", produces: "app/Notifications/<Name>Notification.ts", flags: [], note: "A notification with via()/toMail()." },
  { command: "make:transformer <name>", produces: "app/Transformers/<Name>Transformer.ts", flags: ["-m, --model <model>"], note: "An API transformer mapping a value to its serialized shape." },
];

// Mirror the root CHANGELOG into docs/ so it ships in the package and the docs
// site renders it — the site reads the published package's docs, and CHANGELOG.md
// (repo root) is not part of it. The root file stays the single source of truth.
await writeFile(join(docsDir, "changelog.md"), await readFile(join(root, "CHANGELOG.md"), "utf8"));

const docs = await collectDocs();
const api = await collectApi();

// ---- docs/ai-manifest.json -------------------------------------------------
const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  repo: "https://github.com/shaferllc/keel",
  generated: "run `npm run build:ai` to regenerate",
  docs,
  api,
  generators: GENERATORS,
};
await writeFile(join(docsDir, "ai-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ---- llms.txt --------------------------------------------------------------
const topicDocs = docs.filter((d) => !NON_TOPIC.has(d.slug));
const start = topicDocs.find((d) => d.slug === "getting-started");
const llms = [
  "# Keel",
  "",
  `> ${pkg.description}`,
  "",
  "Keel is a small, legible MVC framework for Node.js: a real service container,",
  "service providers, dot-notation config, expressive routing, models, a queue, and",
  "a code-generating console. Hono powers the HTTP layer; everything above it is Keel's.",
  "Userland imports everything from `@shaferllc/keel/core`.",
  "",
  "## Docs",
  "",
  ...topicDocs.map((d) => `- [${d.title}](${REPO}/${d.path})${d.summary ? `: ${d.summary}` : ""}`),
  "",
  "## Examples",
  "",
  "Every topic has a runnable, type-checked example:",
  "",
  ...topicDocs
    .filter((d) => d.example)
    .map((d) => `- [${d.title} example](${REPO}/${d.example})`),
  "",
  "## Optional",
  "",
  `- [Full text of all docs](${REPO}/llms-full.txt): every guide concatenated into one file`,
  `- [AGENTS.md](${REPO}/AGENTS.md): conventions and workflow for AI agents editing a Keel app`,
  `- [README](${REPO}/README.md): project overview`,
  `- [Changelog](${REPO}/CHANGELOG.md): release history, newest first`,
  "",
];
if (start) void start;
await writeFile(join(root, "llms.txt"), llms.join("\n"));

// ---- llms-full.txt ---------------------------------------------------------
const order = [
  "from-install-to-deploy",
  "getting-started",
  "starter-kits",
  "architecture",
  "container",
  "providers",
  "configuration",
  "routing",
  "controllers",
  "request-response",
  "middleware",
];
const ranked = [
  ...order.map((s) => docs.find((d) => d.slug === s)).filter(Boolean),
  ...docs.filter((d) => !order.includes(d.slug) && !NON_TOPIC.has(d.slug)),
] as DocEntry[];

const parts: string[] = [
  "# Keel — Full Documentation",
  "",
  `> ${pkg.description}`,
  "",
  "This file concatenates every Keel guide for AI context windows. Source lives at",
  `${REPO}/docs. Generated by \`npm run build:ai\`.`,
  "",
];
for (const d of ranked) {
  const md = await readFile(join(root, d.path), "utf8");
  parts.push("\n\n---\n", `<!-- source: ${d.path} -->`, "", md.trim(), "");
}
await writeFile(join(root, "llms-full.txt"), parts.join("\n") + "\n");

console.log(
  `✓ Wrote docs/ai-manifest.json (${docs.length} docs, ${api.length} api symbols), llms.txt, llms-full.txt`,
);
