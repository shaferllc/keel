#!/usr/bin/env node
/**
 * npm create keeljs@latest my-app -- --preset saas
 *
 * Deliberately tiny. The templates live inside @shaferllc/keel, so they version with
 * the framework they demonstrate and a kit cannot lag it — which is exactly how the
 * old starter repo ended up pinned to 0.78.2 while npm was on 0.79.0. All this does
 * is copy one out, fill in two placeholders, and install.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);

const PRESETS = {
  minimal: "Routes, a controller, a JSX view. No database.",
  api: "JSON only — models, migrations, tests. No views.",
  app: "Full-stack: views, sessions, login, password reset, 2FA.",
  saas: "app + teams, roles, invitations, billing, multi-tenancy.",
};

function bail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/* ---------------------------------- args ---------------------------------- */

const argv = process.argv.slice(2);
let target;
let preset = "app";

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];

  if (arg === "--preset" || arg === "-p") preset = argv[++i];
  else if (arg.startsWith("--preset=")) preset = arg.slice("--preset=".length);
  else if (arg === "--help" || arg === "-h") {
    console.log(`
  npm create keeljs@latest <directory> -- --preset <preset>

  Presets:
${Object.entries(PRESETS).map(([name, what]) => `    ${name.padEnd(9)} ${what}`).join("\n")}

  Default: app
`);
    process.exit(0);
  } else if (!arg.startsWith("-")) target = arg;
}

if (!target) bail("Where should it go?  npm create keeljs@latest my-app");
if (!PRESETS[preset]) bail(`No such preset "${preset}". Try: ${Object.keys(PRESETS).join(", ")}`);

const dir = resolve(process.cwd(), target);
if (existsSync(dir) && readdirSync(dir).length) bail(`${target} already exists and isn't empty.`);

/* -------------------------------- templates -------------------------------- */

// The templates ship inside the framework package, so the version we copy from is,
// by construction, the version they were written for.
// Resolve from next to this script (how npx installs it) and fall back to the
// directory the user is standing in — so a globally-installed or linked generator
// still finds the framework instead of dying with a module-not-found.
const keelPkg = resolveKeel();
const keelRoot = dirname(keelPkg);
const version = JSON.parse(readFileSync(keelPkg, "utf8")).version;

const source = join(keelRoot, "templates", preset);
if (!existsSync(source)) bail(`@shaferllc/keel@${version} ships no "${preset}" template.`);

const appName = target
  .split("/")
  .pop()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-|-$/g, "") || "keel-app";

console.log(`\n  Creating ${appName} (${preset}) with keel ${version}\n`);

mkdirSync(dir, { recursive: true });
cpSync(source, dir, { recursive: true });

/* ------------------------------- placeholders ------------------------------ */

// __KEEL_VERSION__ is not a version anyone typed — it's filled in with the version
// the templates actually came from. Hardcoding one in the template is how a starter
// pins itself to a release older than itself.
for (const file of walk(dir)) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("__APP_NAME__") && !text.includes("__KEEL_VERSION__")) continue;

  writeFileSync(
    file,
    text.split("__APP_NAME__").join(appName).split("__KEEL_VERSION__").join(`^${version}`),
  );
}

// .env.example -> .env, so it runs on the first try.
if (existsSync(join(dir, ".env.example"))) {
  cpSync(join(dir, ".env.example"), join(dir, ".env"));
}

/* ---------------------------- kit lock (for kit:sync) --------------------------- */

// Record content hashes so `keel kit:sync` can later refresh files that were never
// customized, without clobbering ones the developer edited.
{
  const files = {};
  for (const file of walk(dir)) {
    const rel = file.slice(dir.length + 1).replace(/\\/g, "/");
    if (rel === ".env" || rel === "package-lock.json") continue;
    files[rel] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  mkdirSync(join(dir, ".keel"), { recursive: true });
  writeFileSync(
    join(dir, ".keel", "kit.json"),
    `${JSON.stringify({ preset, version, files }, null, 2)}\n`,
  );
}

/* --------------------------------- install --------------------------------- */

console.log("  Installing…\n");
const install = spawnSync("npm", ["install"], { cwd: dir, stdio: "inherit" });
if (install.status !== 0) bail("npm install failed.");

const migrates = existsSync(join(dir, "database", "migrations"));

console.log(`
  Done.

    cd ${target}
    ${migrates ? "npm run keel migrate\n    " : ""}npm run dev

  Deploying to Cloudflare:

    wrangler d1 create ${appName}     # paste the id into wrangler.jsonc
    npm run deploy
`);

function resolveKeel() {
  const candidates = [
    () => require.resolve("@shaferllc/keel/package.json"),
    () => createRequire(join(process.cwd(), "noop.js")).resolve("@shaferllc/keel/package.json"),
  ];

  for (const attempt of candidates) {
    try {
      return attempt();
    } catch {
      // try the next one
    }
  }

  bail("Couldn't find @shaferllc/keel. Run this through `npm create keeljs@latest`.");
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === ".git") return [];
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
