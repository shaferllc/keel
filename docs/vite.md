# Vite

Wire a modern frontend build — bundling, hashed filenames, hot module reload —
to Keel's server-rendered HTML, the way modern full-stack frameworks do. There are two
halves:

- **`keelVite()`** — a plugin for `vite.config.ts` (from `@shaferllc/keel/vite`).
  It configures the build and, while the dev server runs, writes a `public/hot`
  marker file.
- **`Vite`** — a server service (from `@shaferllc/keel/core`) that renders the
  `<script>`/`<link>` tags for your entrypoints and resolves asset URLs.

The service switches modes automatically. When the dev server is running the
`hot` file exists, so tags point at it with HMR; otherwise it reads the build
manifest and emits hashed, split, preloaded production tags. Tag generation is
pure string work, so it runs on Node and on the edge alike — only reading the
manifest from disk touches the filesystem.

## Setup

Install Vite (it's an optional peer dependency):

```bash
npm install -D vite
```

Add `vite.config.ts` at your project root and register the plugin with your
entrypoints:

```ts
import { defineConfig } from "vite";
import { keelVite } from "@shaferllc/keel/vite";

export default defineConfig({
  plugins: [
    keelVite({
      entrypoints: ["resources/js/app.ts"],
      // Optional: full-reload the browser when a server view changes.
      reload: ["resources/views/**/*.tsx"],
    }),
  ],
});
```

Create the entrypoint (and import your CSS from it so Vite bundles it):

```ts
// resources/js/app.ts
import "../css/app.css";
console.log("⚓ Keel + Vite");
```

Bind the `Vite` service in a provider and load the manifest/hot file once at
boot:

```ts
import { ServiceProvider, singleton, Vite } from "@shaferllc/keel/core";

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    singleton(Vite, () => new Vite({ entrypoints: ["resources/js/app.ts"] }));
  }
  async boot(): Promise<void> {
    await this.app.make(Vite).loadFromDisk();
  }
}
```

Add the client scripts and ignore the build artifacts:

```jsonc
// package.json
"scripts": {
  "dev:client": "vite",         // dev server with HMR (writes public/hot)
  "build:client": "vite build"  // production build → public/assets + manifest
}
```

```gitignore
public/hot
public/assets/
```

## Rendering the tags

Drop the helpers into your JSX layout's `<head>`. `viteReactRefresh()` comes
first (it's a no-op unless you use React); `viteTags()` renders the entrypoint:

```tsx
import { viteTags, viteReactRefresh } from "@shaferllc/keel/core";

export const Layout = ({ title, children }) => (
  <html>
    <head>
      <title>{title}</title>
      {viteReactRefresh()}
      {viteTags("resources/js/app.ts")}
    </head>
    <body>{children}</body>
  </html>
);
```

Both return raw HTML (a Hono `HtmlEscapedString`), so they render unescaped in
JSX. For an asset that isn't imported by your JS — an image or font referenced
straight from a template — use `viteAsset()`, which returns the dev-server URL in
development and the hashed URL in production:

```tsx
<img src={viteAsset("resources/images/logo.png")} alt="Logo" />
```

## Dev vs. production

Run **two** processes in development — the Vite dev server and the Keel server:

```bash
npm run dev:client   # terminal 1 — Vite + HMR, writes public/hot
npm run dev          # terminal 2 — the Keel app
```

With `public/hot` present, `viteTags()` renders the Vite client plus a module
script pointing at the dev server:

```html
<script type="module" src="http://localhost:5173/@vite/client"></script>
<script type="module" src="http://localhost:5173/resources/js/app.ts"></script>
```

For production, build once — `vite build` writes hashed files and
`public/assets/.vite/manifest.json` — and the same call renders the manifest's
output, with the CSS extracted to a `<link>` and imported chunks preloaded:

```html
<link rel="stylesheet" href="/assets/app-ghi789.css">
<link rel="modulepreload" href="/assets/vendor-def456.js">
<script type="module" src="/assets/app-abc123.js"></script>
```

Serve those built files with the [static middleware](./static-files.md) pointed
at `public/` (Keel's default) — a request for `/assets/app-abc123.js` maps to
`public/assets/app-abc123.js`:

```ts
this.use(serveStatic({ root: "./public" }));
```

## Multiple entrypoints

Each entrypoint produces its own bundle. List them in the config and tag whichever
a page needs — shared vendor chunks are preloaded once, deduplicated:

```ts
keelVite({ entrypoints: ["resources/js/app.ts", "resources/js/admin.ts"] });
```

```tsx
{viteTags(["resources/js/app.ts", "resources/js/admin.ts"])}
```

## React (and other frameworks)

Add the React plugin to `vite.config.ts` and keep `viteReactRefresh()` before
`viteTags()` in your layout — it injects the Fast Refresh preamble in
development and renders nothing in production:

```ts
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [keelVite({ entrypoints: ["resources/js/app.tsx"] }), react()],
});
```

This is exactly what the [Inertia](./inertia.md) adapter's root view uses to load
its client bundle.

## Serving from a CDN

Set `assetsUrl` to your CDN base in **both** the plugin and the service, then
upload `public/assets` after building:

```ts
keelVite({ entrypoints: ["resources/js/app.ts"], assetsUrl: "https://cdn.example.com" });
new Vite({ entrypoints: ["resources/js/app.ts"], assetsUrl: "https://cdn.example.com" });
```

Production tags then point at `https://cdn.example.com/app-abc123.js`.

## Custom tag attributes

Pass `scriptAttributes` / `styleAttributes` to add attributes to the generated
tags — as a static object, or a function that decides per asset:

```ts
new Vite({
  entrypoints: ["resources/js/app.ts"],
  scriptAttributes: { defer: true, crossorigin: "anonymous" },
  styleAttributes: ({ src }) =>
    src.includes("admin") ? { "data-turbo-track": "reload" } : undefined,
});
```

A `true` value renders a bare attribute (`defer`); `false`/`undefined` drops it.

## On the edge

There's no filesystem on Workers, so skip `loadFromDisk` and hand the bundled
manifest straight in — bundle `manifest.json` as a JSON import and pass it to
`useManifest`:

```ts
import manifest from "../public/assets/.vite/manifest.json";
singleton(Vite, () => new Vite({ entrypoints: ["resources/js/app.ts"] }).useManifest(manifest));
```

Tag generation from there is pure and edge-safe.

## Related

Vite pairs with [views](./views.md) (the JSX layout that renders the tags),
[static files](./static-files.md) (serving the build in production), and
[Inertia](./inertia.md) (whose root view loads the client bundle through it).

---

## API reference

### `keelVite(options)` — `@shaferllc/keel/vite`

`keelVite(options: KeelViteOptions): Plugin[]`

The build-time plugin for `vite.config.ts`. Configures the manifest, output
directory, entrypoints, and `base`, and manages the `public/hot` dev marker.

```ts
export default defineConfig({
  plugins: [keelVite({ entrypoints: ["resources/js/app.ts"] })],
});
```

**Notes:** returns an array (spread into `plugins`). Sets `build.manifest`,
`build.outDir` (= `buildDirectory`), a flat `build.assetsDir`, and
`rollupOptions.input`; `base` is `assetsUrl` for a build and `/` for the dev
server. It leaves any of these alone if you set them yourself. Throws if
`entrypoints` is empty.

#### `KeelViteOptions`

```ts
interface KeelViteOptions {
  entrypoints: string | string[]; // required — one bundle per entry
  buildDirectory?: string;        // default "public/assets" (match the service)
  hotFile?: string;               // default "public/hot"
  assetsUrl?: string;             // default "/assets" (or a CDN base)
  reload?: string[];              // globs that trigger a full page reload
}
```

`reload` globs support `*`, `**`, and `?`. A change to a matching file sends a
`full-reload` to the browser — useful for server-rendered views Vite doesn't
otherwise watch.

### `Vite` — `@shaferllc/keel/core`

The server service. Bind it as a singleton, `loadFromDisk()` at boot, and render
its tags from your views (usually through the `viteTags` helper).

```ts
const vite = await new Vite({ entrypoints: ["resources/js/app.ts"] }).loadFromDisk();
```

#### `new Vite(options?)`

`new Vite(options?: ViteOptions)`

Constructs the service. All options are optional; sensible defaults match the
plugin.

```ts
new Vite({ entrypoints: ["resources/js/app.ts"], assetsUrl: "/assets" });
```

#### `loadFromDisk()`

`loadFromDisk(): Promise<this>`

Reads the hot file (dev) or the build manifest (prod) from disk. Node only —
imports `node:fs` dynamically. Call once at boot.

```ts
async boot() { await this.app.make(Vite).loadFromDisk(); }
```

**Notes:** if neither a hot file nor a manifest exists yet, it resolves anyway;
the clear error is raised later, when tags are actually generated. In dev it
re-checks the hot file on each render, so starting the dev server after the app
still works.

#### `useManifest(manifest)`

`useManifest(manifest: Manifest): this`

Injects a manifest directly instead of reading disk — the edge path.

```ts
new Vite({ … }).useManifest(manifest);
```

#### `useHotUrl(url)`

`useHotUrl(url: string | null): this`

Forces the dev-server URL (or `null` for production), bypassing the hot file.

```ts
new Vite({ … }).useHotUrl("http://localhost:5173");
```

#### `generateEntryPointsTags(entrypoints?)`

`generateEntryPointsTags(entrypoints?: string | string[]): HtmlEscapedString`

The `<script>`/`<link>` tags for the given entrypoints (or the constructor's).
Dev-server tags with HMR while developing; hashed, preloaded tags in production.

```ts
vite.generateEntryPointsTags("resources/js/app.ts");
```

**Notes:** the `viteTags()` helper wraps this. Throws if an entrypoint is missing
from the manifest, or if neither a hot file nor a manifest is available.

#### `assetPath(asset)`

`assetPath(asset: string): string`

The public URL for one asset — the dev-server URL in development, the hashed
manifest URL in production.

```ts
vite.assetPath("resources/images/logo.png");
```

**Notes:** the `viteAsset()` helper wraps this. Throws in production if the asset
isn't in the manifest.

#### `reactHMR()`

`reactHMR(): HtmlEscapedString`

The React Fast Refresh preamble (dev only; empty in production). Render it before
your entry script when using `@vitejs/plugin-react`.

```ts
vite.reactHMR();
```

**Notes:** the `viteReactRefresh()` helper wraps this.

#### `hot()`

`hot(): string | null`

The dev-server URL when Vite is running, else `null`. A loaded manifest always
means production.

#### `manifest()`

`manifest(): Manifest`

The parsed production manifest. Throws a helpful error if no build has been
loaded.

### Helpers — `@shaferllc/keel/core`

Free functions that resolve the app's bound `Vite` instance — use them in views
without threading the container through.

```ts
viteTags(entrypoints?: string | string[]): HtmlEscapedString
viteAsset(asset: string): string
viteReactRefresh(): HtmlEscapedString
```

Each throws a configuration error if `Vite` isn't bound in a provider.

### Types

#### `ViteOptions`

```ts
interface ViteOptions {
  entrypoints?: string | string[];
  hotFile?: string;         // default "public/hot"
  buildDirectory?: string;  // default "public/assets"
  manifestFile?: string;    // default "<buildDirectory>/.vite/manifest.json"
  assetsUrl?: string;       // default "/assets"
  scriptAttributes?: ViteAttributes;
  styleAttributes?: ViteAttributes;
}
```

#### `ViteAttributes`

```ts
type ViteAttributes =
  | Record<string, string | boolean | null | undefined>
  | ((asset: { src: string; url: string }) => Record<string, AttrValue> | undefined);
```

Attributes for generated tags. `true` → a bare attribute; `false`/`null`/
`undefined` → omitted; a string → `key="value"` (HTML-escaped).

#### `Manifest` / `ManifestChunk`

```ts
type Manifest = Record<string, ManifestChunk>;

interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}
```

Vite's `manifest.json`, as produced by the build. You rarely touch it directly —
`generateEntryPointsTags` and `assetPath` read it for you.
