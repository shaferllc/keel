/**
 * The Keel Vite plugin — the build-time half of Keel's Vite integration. Drop it
 * into `vite.config.ts` and it wires Vite to the `Vite` server service in
 * `@shaferllc/keel/core`:
 *
 *   import { defineConfig } from "vite";
 *   import { keelVite } from "@shaferllc/keel/vite";
 *
 *   export default defineConfig({
 *     plugins: [keelVite({ entrypoints: ["resources/js/app.ts"] })],
 *   });
 *
 * It does three things:
 *   • Configures the build — manifest on, output to `public/assets`, your
 *     entrypoints as the Rollup inputs, and `base` set to `assetsUrl` so hashed
 *     asset URLs resolve in production.
 *   • Writes a `public/hot` file with the dev-server URL while `vite` runs (and
 *     removes it on exit) — the marker the `Vite` service reads to switch into
 *     dev mode with HMR.
 *   • Optionally triggers a full browser reload when files matching `reload`
 *     globs change (e.g. server-rendered views Vite doesn't otherwise watch).
 *
 * This module runs only in the Node build environment (never on the edge), so it
 * imports `node:fs`/`node:path` directly.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AddressInfo } from "node:net";
import type { ConfigEnv, Plugin, UserConfig, ViteDevServer } from "vite";

export interface KeelViteOptions {
  /** Entry files, each producing its own bundle. Required. */
  entrypoints: string | string[];
  /** Build output directory (must match the server's `buildDirectory`). Default: `public/assets`. */
  buildDirectory?: string;
  /** The dev-server marker file the `Vite` service reads. Default: `public/hot`. */
  hotFile?: string;
  /** Public URL / CDN base for built assets. Default: `/assets`. */
  assetsUrl?: string;
  /** Glob patterns that trigger a full page reload when changed (e.g. views). */
  reload?: string[];
}

/** The Keel Vite plugin(s). Spread-safe: returns an array to add to `plugins`. */
export function keelVite(options: KeelViteOptions): Plugin[] {
  const entrypoints = toArray(options.entrypoints);
  if (entrypoints.length === 0) {
    throw new Error("keelVite: `entrypoints` must list at least one entry file.");
  }
  const buildDirectory = trimTrailingSlash(options.buildDirectory ?? "public/assets");
  const hotFile = options.hotFile ?? "public/hot";
  const assetsUrl = options.assetsUrl ?? "/assets";

  const plugins: Plugin[] = [
    {
      name: "keel:vite",
      enforce: "post",

      config(user: UserConfig, env: ConfigEnv): UserConfig {
        const build = env.command === "build";
        return {
          // Dev serves from the root; the build prefixes hashed assets with assetsUrl.
          base: build ? withTrailingSlash(assetsUrl) : "/",
          // Keel serves `public/` itself — don't let Vite copy it into the bundle.
          publicDir: user.publicDir ?? false,
          build: {
            manifest: user.build?.manifest ?? true,
            outDir: user.build?.outDir ?? buildDirectory,
            // Flat output: assetsUrl already namespaces the files, so don't nest
            // them under another `assets/` folder.
            assetsDir: user.build?.assetsDir ?? "",
            emptyOutDir: user.build?.emptyOutDir ?? true,
            rollupOptions: {
              ...user.build?.rollupOptions,
              input: user.build?.rollupOptions?.input ?? entrypoints,
            },
          },
        };
      },

      configureServer(server: ViteDevServer): void {
        const write = () => {
          mkdirSync(dirname(hotFile), { recursive: true });
          writeFileSync(hotFile, devServerUrl(server));
        };
        const clean = () => {
          try {
            rmSync(hotFile);
          } catch {
            // already gone — nothing to do
          }
        };

        server.httpServer?.once("listening", write);
        server.httpServer?.once("close", clean);
        process.once("exit", clean);
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
          process.once(signal, () => {
            clean();
            process.exit();
          });
        }
      },
    },
  ];

  if (options.reload && options.reload.length > 0) {
    const matchers = options.reload.map(globToRegExp);
    plugins.push({
      name: "keel:vite-reload",
      handleHotUpdate({ file, server }) {
        if (matchers.some((re) => re.test(file))) {
          server.ws.send({ type: "full-reload", path: "*" });
        }
      },
    });
  }

  return plugins;
}

/* -------------------------------- helpers --------------------------------- */

function devServerUrl(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? (address as AddressInfo).port : 5173;
  const https = Boolean(server.config.server.https);
  const protocol = https ? "https" : "http";
  const configured = server.config.server.host;
  const host = typeof configured === "string" ? configured : "localhost";
  return `${protocol}://${host}:${port}`;
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/** A small glob → RegExp for `reload` patterns: supports `**`, `*`, and `?`. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // collapse `**/`
      } else {
        re += "[^/]*";
      }
    } else if (char === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(char)) {
      re += `\\${char}`;
    } else {
      re += char;
    }
  }
  return new RegExp(`${re}$`);
}
