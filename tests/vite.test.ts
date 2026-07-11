import { test } from "node:test";
import assert from "node:assert/strict";

import { Vite, type Manifest } from "../src/core/vite.js";
import { keelVite } from "../src/vite/index.js";

/* --------------------------------- service -------------------------------- */

const manifest: Manifest = {
  "resources/js/app.ts": {
    file: "app-abc123.js",
    src: "resources/js/app.ts",
    isEntry: true,
    imports: ["_vendor-def456.js"],
    css: ["app-ghi789.css"],
  },
  "_vendor-def456.js": {
    file: "vendor-def456.js",
    css: ["vendor-jkl012.css"],
  },
  "resources/js/admin.ts": {
    file: "admin-mno345.js",
    src: "resources/js/admin.ts",
    isEntry: true,
    imports: ["_vendor-def456.js"],
  },
};

test("dev mode emits the Vite client and module scripts from the dev server", () => {
  const vite = new Vite({ entrypoints: ["resources/js/app.ts"] }).useHotUrl("http://localhost:5173");
  const tags = String(vite.generateEntryPointsTags());
  assert.match(tags, /<script type="module" src="http:\/\/localhost:5173\/@vite\/client"><\/script>/);
  assert.match(tags, /<script type="module" src="http:\/\/localhost:5173\/resources\/js\/app\.ts"><\/script>/);
});

test("dev mode links stylesheet entrypoints instead of scripting them", () => {
  const vite = new Vite({}).useHotUrl("http://localhost:5173/");
  const tags = String(vite.generateEntryPointsTags(["resources/css/app.css"]));
  assert.match(tags, /<link rel="stylesheet" href="http:\/\/localhost:5173\/resources\/css\/app\.css">/);
  assert.doesNotMatch(tags, /app\.css"><\/script>/);
});

test("dev hot() trims a trailing slash", () => {
  assert.equal(new Vite({}).useHotUrl("http://localhost:5173/").hot(), "http://localhost:5173");
});

test("production emits css links, modulepreloads, and the entry script, in order", () => {
  const vite = new Vite({ entrypoints: ["resources/js/app.ts"] }).useManifest(manifest);
  const tags = String(vite.generateEntryPointsTags()).split("\n");
  assert.deepEqual(tags, [
    '<link rel="stylesheet" href="/assets/vendor-jkl012.css">',
    '<link rel="stylesheet" href="/assets/app-ghi789.css">',
    '<link rel="modulepreload" href="/assets/vendor-def456.js">',
    '<script type="module" src="/assets/app-abc123.js"></script>',
  ]);
});

test("production dedupes a shared vendor chunk across entrypoints", () => {
  const vite = new Vite({}).useManifest(manifest);
  const tags = String(
    vite.generateEntryPointsTags(["resources/js/app.ts", "resources/js/admin.ts"]),
  );
  // The shared vendor preload appears exactly once.
  assert.equal(tags.match(/vendor-def456\.js/g)?.length, 1);
  assert.match(tags, /<script type="module" src="\/assets\/app-abc123\.js">/);
  assert.match(tags, /<script type="module" src="\/assets\/admin-mno345\.js">/);
});

test("assetsUrl can point at a CDN", () => {
  const vite = new Vite({ assetsUrl: "https://cdn.example.com/build/" }).useManifest(manifest);
  assert.equal(vite.assetPath("resources/js/app.ts"), "https://cdn.example.com/build/app-abc123.js");
});

test("assetPath resolves dev vs production and throws on an unknown asset", () => {
  const dev = new Vite({}).useHotUrl("http://localhost:5173");
  assert.equal(dev.assetPath("resources/images/logo.png"), "http://localhost:5173/resources/images/logo.png");

  const prod = new Vite({}).useManifest(manifest);
  assert.equal(prod.assetPath("resources/js/app.ts"), "/assets/app-abc123.js");
  assert.throws(() => prod.assetPath("nope.ts"), /Unable to locate "nope\.ts"/);
});

test("script and style attributes apply, as objects or functions", () => {
  const vite = new Vite({
    entrypoints: ["resources/js/app.ts"],
    scriptAttributes: { defer: true, crossorigin: "anonymous", nomodule: false },
    styleAttributes: ({ src }) => (src.includes("app-ghi") ? { "data-track": "reload" } : undefined),
  }).useManifest(manifest);
  const tags = String(vite.generateEntryPointsTags());
  assert.match(tags, /<script type="module" src="\/assets\/app-abc123\.js" defer crossorigin="anonymous"><\/script>/);
  assert.doesNotMatch(tags, /nomodule/); // false attribute is dropped
  assert.match(tags, /<link rel="stylesheet" href="\/assets\/app-ghi789\.css" data-track="reload">/);
  assert.doesNotMatch(tags, /vendor-jkl012\.css" data-track/); // function returned undefined here
});

test("reactHMR emits the preamble in dev and nothing in production", () => {
  assert.equal(String(new Vite({}).useManifest(manifest).reactHMR()), "");
  const dev = String(new Vite({}).useHotUrl("http://localhost:5173").reactHMR());
  assert.match(dev, /RefreshRuntime/);
  assert.match(dev, /http:\/\/localhost:5173\/@react-refresh/);
});

test("attribute values are HTML-escaped", () => {
  const vite = new Vite({
    entrypoints: ["resources/js/app.ts"],
    scriptAttributes: { "data-x": '"><b' },
  }).useManifest(manifest);
  const tags = String(vite.generateEntryPointsTags());
  assert.match(tags, /data-x="&quot;&gt;&lt;b"/);
});

test("manifest() throws a helpful error when no build is loaded", () => {
  assert.throws(() => new Vite({}).manifest(), /Vite manifest not found/);
});

test("generating tags with neither a hot file nor a manifest throws", () => {
  assert.throws(() => new Vite({ entrypoints: ["a.ts"] }).generateEntryPointsTags(), /manifest not found/);
});

test("an entrypoint missing from the manifest throws", () => {
  assert.throws(
    () => new Vite({}).useManifest(manifest).generateEntryPointsTags(["ghost.ts"]),
    /Entrypoint "ghost\.ts" is not in the Vite manifest/,
  );
});

/* --------------------------------- plugin --------------------------------- */

// The config hook is a plain function in our plugin; call it directly.
type ConfigHook = (user: unknown, env: { command: string; mode: string }) => Record<string, any>;

test("keelVite requires at least one entrypoint", () => {
  assert.throws(() => keelVite({ entrypoints: [] }), /at least one entry file/);
});

test("keelVite configures the production build", () => {
  const [plugin] = keelVite({ entrypoints: ["resources/js/app.ts"] });
  assert.equal(plugin!.name, "keel:vite");
  const config = plugin!.config as unknown as ConfigHook;
  const out = config({}, { command: "build", mode: "production" });
  assert.equal(out.base, "/assets/");
  assert.equal(out.publicDir, false);
  assert.equal(out.build.outDir, "public/assets");
  assert.equal(out.build.manifest, true);
  assert.equal(out.build.assetsDir, "");
  assert.deepEqual(out.build.rollupOptions.input, ["resources/js/app.ts"]);
});

test("keelVite serves from root in dev and honors a custom assetsUrl/buildDirectory", () => {
  const [plugin] = keelVite({
    entrypoints: ["a.ts"],
    assetsUrl: "https://cdn.example.com",
    buildDirectory: "dist/public",
  });
  const config = plugin!.config as unknown as ConfigHook;
  assert.equal(config({}, { command: "serve", mode: "development" }).base, "/");
  const built = config({}, { command: "build", mode: "production" });
  assert.equal(built.base, "https://cdn.example.com/");
  assert.equal(built.build.outDir, "dist/public");
});

test("keelVite adds a full-reload plugin only when reload globs are given", () => {
  assert.equal(keelVite({ entrypoints: ["a.ts"] }).length, 1);

  const plugins = keelVite({ entrypoints: ["a.ts"], reload: ["resources/views/**/*.tsx"] });
  assert.equal(plugins.length, 2);
  const reload = plugins.find((p) => p.name === "keel:vite-reload")!;

  const sent: unknown[] = [];
  const server = { ws: { send: (payload: unknown) => sent.push(payload) } };
  const handle = reload.handleHotUpdate as unknown as (ctx: {
    file: string;
    server: unknown;
  }) => void;

  handle({ file: "/app/resources/views/home.tsx", server });
  handle({ file: "/app/routes/web.ts", server }); // no match
  assert.deepEqual(sent, [{ type: "full-reload", path: "*" }]);
});
