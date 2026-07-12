import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Builds the Watch dashboard SPA into `dist/` beside this file, with fixed
 * filenames (`watch.js`, `watch.css`) so the provider's shell can reference them
 * without a manifest. Self-contained: Preact is bundled in, no external requests.
 * Run it with `npm run build:watch`.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Preact's automatic JSX runtime, without the preset plugin.
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./main.tsx", import.meta.url)),
      formats: ["es"],
      fileName: () => "watch.js",
    },
    rollupOptions: {
      output: { assetFileNames: "watch.[ext]" },
    },
  },
});
