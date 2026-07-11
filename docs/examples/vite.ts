// Type-check harness for docs/vite.md. Every type-checkable snippet in the guide
// is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never run.
//
// The `vite.config.ts` / `keelVite` snippets aren't covered here (they live in
// the `@shaferllc/keel/vite` entry and need Vite's own types); tests/vite.test.ts
// type-checks that plugin API instead.
import {
  ServiceProvider,
  singleton,
  serveStatic,
  Vite,
  viteTags,
  viteAsset,
  viteReactRefresh,
  type ViteOptions,
  type ViteAttributes,
  type Manifest,
  type ManifestChunk,
} from "@shaferllc/keel/core";

// Constructing + options
export function constructing() {
  const basic = new Vite({ entrypoints: ["resources/js/app.ts"], assetsUrl: "/assets" });

  const cdn = new Vite({
    entrypoints: ["resources/js/app.ts", "resources/js/admin.ts"],
    assetsUrl: "https://cdn.example.com",
  });

  const withAttrs = new Vite({
    entrypoints: ["resources/js/app.ts"],
    scriptAttributes: { defer: true, crossorigin: "anonymous" },
    styleAttributes: ({ src }) =>
      src.includes("admin") ? { "data-turbo-track": "reload" } : undefined,
  });

  return { basic, cdn, withAttrs };
}

// Loading + injection
export async function loading() {
  const disk = await new Vite({ entrypoints: ["resources/js/app.ts"] }).loadFromDisk();

  const manifest: Manifest = {
    "resources/js/app.ts": { file: "app-abc123.js", isEntry: true, css: ["app-ghi.css"] },
  };
  const edge = new Vite({ entrypoints: ["resources/js/app.ts"] }).useManifest(manifest);
  const forced = new Vite({}).useHotUrl("http://localhost:5173");

  return { disk, edge, forced };
}

// Tag generation + resolution
export function rendering() {
  const vite = new Vite({ entrypoints: ["resources/js/app.ts"] }).useHotUrl("http://localhost:5173");
  const one = vite.generateEntryPointsTags("resources/js/app.ts");
  const many = vite.generateEntryPointsTags(["resources/js/app.ts", "resources/js/admin.ts"]);
  const preamble = vite.reactHMR();
  const asset = vite.assetPath("resources/images/logo.png");
  const hot: string | null = vite.hot();
  return { one, many, preamble, asset, hot };
}

export function manifestAccess() {
  const vite = new Vite({}).useManifest({ "a.ts": { file: "a.hash.js" } });
  const manifest: Manifest = vite.manifest();
  const chunk: ManifestChunk | undefined = manifest["a.ts"];
  return chunk;
}

// Binding in a provider
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    singleton(Vite, () => new Vite({ entrypoints: ["resources/js/app.ts"] }));
  }
  async boot(): Promise<void> {
    await this.app.make(Vite).loadFromDisk();
  }
}

// Serving the build in production
export function serving() {
  return serveStatic({ root: "./public" });
}

// Free helpers used in views
export function helpers() {
  const refresh = viteReactRefresh();
  const tags = viteTags("resources/js/app.ts");
  const many = viteTags(["resources/js/app.ts", "resources/js/admin.ts"]);
  const logo = viteAsset("resources/images/logo.png");
  return { refresh, tags, many, logo };
}

// Types
const options: ViteOptions = {
  entrypoints: ["resources/js/app.ts"],
  hotFile: "public/hot",
  buildDirectory: "public/assets",
  assetsUrl: "/assets",
};

const attributes: ViteAttributes = ({ src, url }) => ({ "data-src": src, "data-url": url });

export { options, attributes };
