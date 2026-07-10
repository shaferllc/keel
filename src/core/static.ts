/**
 * A static file server middleware. Serves files from a directory (default
 * `public/`) before your routes run — if a file matches the request path it's
 * sent with caching headers; otherwise the request continues to your routes.
 *
 * `node:fs` is imported dynamically, so the core still loads on the edge; add
 * this middleware only in Node apps (on Workers, serve assets via the platform).
 *
 *   this.use(serveStatic());                 // ./public
 *   this.use(serveStatic({ root: "./assets", maxAge: 86400, immutable: true }));
 */

import type { MiddlewareHandler } from "hono";
import { getMimeType } from "hono/utils/mime";

export interface StaticOptions {
  /** Directory to serve from. Default: "./public". */
  root?: string;
  /** Index file for directory requests. Default: "index.html". */
  index?: string;
  /** Dot-file policy: "ignore" (404 → next), "deny" (403), "allow". Default: "ignore". */
  dotFiles?: "ignore" | "deny" | "allow";
  /** Cache-Control max-age in seconds. Omit for no Cache-Control header. */
  maxAge?: number;
  /** Add the `immutable` Cache-Control directive (for hashed filenames). */
  immutable?: boolean;
  /** Extra headers per file. */
  headers?: (path: string) => Record<string, string> | undefined;
}

export function serveStatic(options: StaticOptions = {}): MiddlewareHandler {
  const root = (options.root ?? "./public").replace(/\/+$/, "");
  const index = options.index ?? "index.html";
  const dotFiles = options.dotFiles ?? "ignore";

  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
    if (urlPath.includes("..")) return next(); // path traversal guard

    const hasDotSegment = urlPath.split("/").some((seg) => seg.startsWith("."));
    if (hasDotSegment) {
      if (dotFiles === "deny") return c.text("Forbidden", 403);
      if (dotFiles === "ignore") return next();
    }

    try {
      const { stat, readFile } = await import("node:fs/promises");
      let filePath = root + urlPath;
      let stats = await stat(filePath).catch(() => null);
      if (stats?.isDirectory()) {
        filePath = `${filePath.replace(/\/+$/, "")}/${index}`;
        stats = await stat(filePath).catch(() => null);
      }
      if (!stats || !stats.isFile()) return next();

      const etag = `W/"${stats.size}-${Math.round(stats.mtimeMs)}"`;
      c.header("Content-Type", getMimeType(filePath) ?? "application/octet-stream");
      c.header("Last-Modified", stats.mtime.toUTCString());
      c.header("ETag", etag);
      if (options.maxAge != null) {
        c.header(
          "Cache-Control",
          `public, max-age=${options.maxAge}${options.immutable ? ", immutable" : ""}`,
        );
      }
      const extra = options.headers?.(filePath);
      if (extra) for (const [k, v] of Object.entries(extra)) c.header(k, v);

      if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
      if (c.req.method === "HEAD") return c.body(null, 200);
      return c.body(await readFile(filePath), 200);
    } catch {
      return next();
    }
  };
}
