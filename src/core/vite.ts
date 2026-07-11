/**
 * Vite integration. Wire a modern frontend build — bundling, hashed filenames,
 * hot module reload — to Keel's server-rendered HTML, the way Laravel and
 * AdonisJS do. `Vite` is the *server* half: it emits the `<script>`/`<link>`
 * tags for your entrypoints and resolves individual asset URLs, switching
 * automatically between two modes:
 *
 *   • Dev — a `public/hot` file (written by the `keelVite()` plugin when the
 *     Vite dev server starts) points at `http://localhost:5173`. Tags load
 *     straight from that server, with HMR.
 *   • Prod — no hot file, so it reads `public/assets/.vite/manifest.json` and
 *     emits the hashed, split, preloaded production tags.
 *
 *   // in a service provider
 *   const vite = await new Vite({ entrypoints: ["resources/js/app.ts"] }).loadFromDisk();
 *   singleton(Vite, () => vite);
 *
 *   // in a JSX layout <head>
 *   {viteReactRefresh()}
 *   {viteTags("resources/js/app.ts")}
 *
 * Tag generation is pure string work over an in-memory manifest, so it's
 * edge-safe: on Workers, skip `loadFromDisk` and hand the bundled manifest in
 * with `useManifest(...)`. Only reading from disk touches `node:fs`, and that's
 * imported dynamically (like the static server), so the core still loads on the
 * edge.
 */

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { bound, make } from "./helpers.js";

/** One chunk in Vite's `manifest.json`. */
export interface ManifestChunk {
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

/** A parsed Vite build manifest: source path → chunk. */
export type Manifest = Record<string, ManifestChunk>;

/** An HTML attribute value: a string, `true` (bare attribute), or absent. */
export type AttrValue = string | boolean | null | undefined;
/** A bag of HTML attributes, or a function that computes them per asset. */
export type Attributes =
  | Record<string, AttrValue>
  | ((asset: { src: string; url: string }) => Record<string, AttrValue> | undefined);

export interface ViteOptions {
  /** Entrypoints to tag when `generateEntryPointsTags()` is called with none. */
  entrypoints?: string | string[];
  /** The dev-server marker file. Default: `public/hot`. */
  hotFile?: string;
  /** Where the build lands (holds `.vite/manifest.json`). Default: `public/assets`. */
  buildDirectory?: string;
  /** Override the manifest path. Default: `<buildDirectory>/.vite/manifest.json`. */
  manifestFile?: string;
  /** Public URL prefix for built assets (a CDN base works too). Default: `/assets`. */
  assetsUrl?: string;
  /** Extra attributes for generated `<script>` tags. */
  scriptAttributes?: Attributes;
  /** Extra attributes for generated `<link rel="stylesheet">` tags. */
  styleAttributes?: Attributes;
}

const STYLE_EXTENSIONS = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)(\?|$)/;

export class Vite {
  private entrypoints: string[];
  private hotFile: string;
  private manifestFile: string;
  private assetsUrl: string;
  private scriptAttributes: Attributes;
  private styleAttributes: Attributes;

  private hotUrl: string | null = null;
  private parsed: Manifest | null = null;
  private fs: typeof import("node:fs") | null = null;

  constructor(options: ViteOptions = {}) {
    this.entrypoints = normalizeList(options.entrypoints);
    this.hotFile = options.hotFile ?? "public/hot";
    const buildDirectory = trimSlashes(options.buildDirectory ?? "public/assets");
    this.manifestFile = options.manifestFile ?? `${buildDirectory}/.vite/manifest.json`;
    this.assetsUrl = (options.assetsUrl ?? "/assets").replace(/\/+$/, "");
    this.scriptAttributes = options.scriptAttributes ?? {};
    this.styleAttributes = options.styleAttributes ?? {};
  }

  /* ------------------------------- loading -------------------------------- */

  /**
   * Read the hot file (dev) or the build manifest (prod) from disk. Call once at
   * boot from a service provider. Node only — uses `node:fs`.
   */
  async loadFromDisk(): Promise<this> {
    this.fs = await import("node:fs");
    this.refreshHot();
    if (!this.hotUrl) {
      // No dev server — try the production manifest. Leave it null if there's no
      // build yet; tag generation raises a clear error when it's actually used.
      try {
        this.parsed = JSON.parse(this.fs.readFileSync(this.manifestFile, "utf8")) as Manifest;
      } catch {
        this.parsed = null;
      }
    }
    return this;
  }

  /** Inject a manifest directly — for the edge, where there's no filesystem. */
  useManifest(manifest: Manifest): this {
    this.parsed = manifest;
    return this;
  }

  /** Force the dev-server URL (or `null` for prod). Bypasses the hot file. */
  useHotUrl(url: string | null): this {
    this.hotUrl = url ? url.replace(/\/+$/, "") : null;
    return this;
  }

  /** Re-read the hot file if we're on Node and no manifest has claimed prod mode. */
  private refreshHot(): void {
    if (!this.fs) return;
    try {
      const contents = this.fs.readFileSync(this.hotFile, "utf8").trim();
      this.hotUrl = contents ? contents.replace(/\/+$/, "") : null;
    } catch {
      this.hotUrl = null;
    }
  }

  /** The dev-server URL when running Vite, else `null` (production). */
  hot(): string | null {
    // A loaded manifest means we built for production — never dev.
    if (this.parsed) return null;
    this.refreshHot();
    return this.hotUrl;
  }

  /** The parsed production manifest. Throws if it hasn't been loaded. */
  manifest(): Manifest {
    if (!this.parsed) {
      throw new Error(
        `Vite manifest not found at "${this.manifestFile}". Run the client build ` +
          `(e.g. \`vite build\`) or start the dev server.`,
      );
    }
    return this.parsed;
  }

  /* ---------------------------- tag generation ---------------------------- */

  /**
   * The `<script>`/`<link>` tags for one or more entrypoints — dev-server URLs
   * with HMR while developing, hashed + preloaded tags in production. Falls back
   * to the entrypoints passed to the constructor.
   */
  generateEntryPointsTags(entrypoints?: string | string[]): HtmlEscapedString {
    const entries = entrypoints !== undefined ? normalizeList(entrypoints) : this.entrypoints;
    const hot = this.hot();
    const tags = hot ? this.devTags(hot, entries) : this.productionTags(entries);
    return raw(tags.join("\n"));
  }

  /** The public URL for a single asset (an image, a font) — dev or hashed prod. */
  assetPath(asset: string): string {
    const hot = this.hot();
    if (hot) return `${hot}/${trimSlashes(asset)}`;
    const chunk = this.manifest()[asset];
    if (!chunk) {
      throw new Error(`Unable to locate "${asset}" in the Vite manifest.`);
    }
    return `${this.assetsUrl}/${chunk.file}`;
  }

  /**
   * The React Fast Refresh preamble — required before your entry script when
   * using `@vitejs/plugin-react`. Empty in production.
   */
  reactHMR(): HtmlEscapedString {
    const hot = this.hot();
    if (!hot) return raw("");
    return raw(
      `<script type="module">\n` +
        `import RefreshRuntime from "${hot}/@react-refresh"\n` +
        `RefreshRuntime.injectIntoGlobalHook(window)\n` +
        `window.$RefreshReg$ = () => {}\n` +
        `window.$RefreshSig$ = () => (type) => type\n` +
        `window.__vite_plugin_react_preamble_installed__ = true\n` +
        `</script>`,
    );
  }

  /* ------------------------------ internals ------------------------------- */

  private devTags(hot: string, entries: string[]): string[] {
    // The Vite client (its own module) drives HMR — always first.
    const tags = [`<script type="module" src="${hot}/@vite/client"></script>`];
    for (const entry of entries) {
      const url = `${hot}/${trimSlashes(entry)}`;
      tags.push(this.tagFor(entry, url));
    }
    return tags;
  }

  private productionTags(entries: string[]): string[] {
    const manifest = this.manifest();
    const styles: string[] = [];
    const preloads: string[] = [];
    const scripts: string[] = [];
    const seen = new Set<string>();

    const walk = (name: string, isEntry: boolean) => {
      const chunk = manifest[name];
      if (!chunk || seen.has(name)) return;
      seen.add(name);

      for (const imported of chunk.imports ?? []) walk(imported, false);
      for (const css of chunk.css ?? []) {
        const url = `${this.assetsUrl}/${css}`;
        pushUnique(styles, this.styleTag(css, url));
      }

      const url = `${this.assetsUrl}/${chunk.file}`;
      if (isEntry) pushUnique(scripts, this.scriptTag(name, url));
      else pushUnique(preloads, `<link rel="modulepreload" href="${url}">`);
    };

    for (const entry of entries) {
      const chunk = manifest[entry];
      if (!chunk) {
        throw new Error(`Entrypoint "${entry}" is not in the Vite manifest.`);
      }
      walk(entry, true);
    }

    // Styles, then preloads, then the entry scripts.
    return [...styles, ...preloads, ...scripts];
  }

  /** In dev, a style entrypoint is a `<link>`; everything else a module script. */
  private tagFor(entry: string, url: string): string {
    return STYLE_EXTENSIONS.test(entry) ? this.styleTag(entry, url) : this.scriptTag(entry, url);
  }

  private scriptTag(src: string, url: string): string {
    const attrs = renderAttributes(
      { type: "module", src: url, ...resolveAttributes(this.scriptAttributes, src, url) },
    );
    return `<script${attrs}></script>`;
  }

  private styleTag(src: string, url: string): string {
    const attrs = renderAttributes(
      { rel: "stylesheet", href: url, ...resolveAttributes(this.styleAttributes, src, url) },
    );
    return `<link${attrs}>`;
  }
}

/* -------------------------------- helpers --------------------------------- */

function resolveAttributes(
  attributes: Attributes,
  src: string,
  url: string,
): Record<string, AttrValue> {
  const resolved = typeof attributes === "function" ? attributes({ src, url }) : attributes;
  return resolved ?? {};
}

function renderAttributes(attributes: Record<string, AttrValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value == null) continue;
    if (value === true) parts.push(key);
    else parts.push(`${key}="${escapeAttribute(String(value))}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeList(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/* -------------------------------- globals --------------------------------- */

function resolveVite(): Vite {
  if (!bound(Vite)) {
    throw new Error(
      "Vite is not configured. Bind it in a provider: " +
        'singleton(Vite, () => new Vite({ entrypoints: ["resources/js/app.ts"] })).',
    );
  }
  return make(Vite);
}

/** The entrypoint tags for the current app's Vite instance. Use in a JSX `<head>`. */
export function viteTags(entrypoints?: string | string[]): HtmlEscapedString {
  return resolveVite().generateEntryPointsTags(entrypoints);
}

/** The URL for a single asset through the current app's Vite instance. */
export function viteAsset(asset: string): string {
  return resolveVite().assetPath(asset);
}

/** The React Fast Refresh preamble (dev only) for the current app's Vite instance. */
export function viteReactRefresh(): HtmlEscapedString {
  return resolveVite().reactHMR();
}
