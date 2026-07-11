// Type-check harness for docs/static-files.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed option or
// wrong signature fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  HttpKernel,
  serveStatic,
  type Application,
  type StaticOptions,
} from "@shaferllc/keel/core";

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(serveStatic()); // serves ./public
  }
}

export function options() {
  serveStatic({
    root: "./public",
    index: "index.html",
    dotFiles: "ignore",
    maxAge: 86400,
    immutable: true,
    headers: (path) =>
      path.endsWith(".html") ? { "X-Frame-Options": "DENY" } : undefined,
  });
}

export function immutableAssets(kernel: HttpKernel) {
  kernel.use(serveStatic({ root: "./dist", maxAge: 31536000, immutable: true }));
}

export function perFileHeaders() {
  serveStatic({
    headers: (path): Record<string, string> | undefined => {
      if (path.endsWith(".html")) return { "X-Frame-Options": "DENY" };
      if (path.endsWith(".wasm")) return { "Cross-Origin-Embedder-Policy": "require-corp" };
      return undefined;
    },
  });
}

export function reference(kernel: HttpKernel) {
  const assets = serveStatic({ root: "./public", maxAge: 86400 });
  kernel.use(assets);

  // No-argument form is valid — all options default.
  serveStatic();
}

// Interface / type seam
const staticOpts: StaticOptions = {
  root: "./dist",
  index: "index.html",
  dotFiles: "deny",
  maxAge: 31536000,
  immutable: true,
  headers: (path) => (path.endsWith(".html") ? { "X-Frame-Options": "DENY" } : undefined),
};
serveStatic(staticOpts);

export { staticOpts };
