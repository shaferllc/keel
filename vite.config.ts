import { defineConfig } from "vite";
import { keelVite } from "@shaferllc/keel/vite";

/**
 * Frontend build config. `keelVite` sets the manifest/output/entrypoints and
 * writes `public/hot` while the dev server runs. Start it with
 * `npm run dev:client` (HMR); ship with `npm run build:client`.
 */
export default defineConfig({
  plugins: [
    keelVite({
      entrypoints: ["resources/js/app.ts"],
      // Full-reload the browser when a server-rendered view or route changes.
      reload: ["resources/views/**/*.tsx", "routes/**/*.ts"],
    }),
  ],
});
