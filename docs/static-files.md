# Static Files

`serveStatic()` serves files from a directory (default `public/`) **before** your
routes run. If a file matches the request path it's sent with caching headers;
otherwise the request falls through to your routes.

## Enable it

Add the middleware to your HTTP kernel:

```ts
import { HttpKernel, serveStatic } from "@shaferllc/keel/core";

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(serveStatic()); // serves ./public
  }
}
```

Now `./public/css/style.css` is served at `/css/style.css`, and `./public/index.html`
at `/`.

## How a request is matched

For each request the middleware:

1. **Skips non-reads.** Only `GET` and `HEAD` are handled; any other method falls
   straight through to your routes.
2. **Decodes and guards the path.** The URL pathname is `decodeURIComponent`'d,
   then any path containing `..` is rejected (falls through) — so percent-encoded
   traversal (`%2e%2e`) is caught too.
3. **Applies the dot-file policy** (see below).
4. **Resolves the file.** It looks for `root + urlPath` on disk. If that's a
   directory, it appends `index` (`index.html`) and looks again. If nothing
   resolves to a real file, the request falls through.
5. **Sends the file** with `Content-Type`, `Last-Modified`, `ETag`, and — when
   configured — `Cache-Control` headers.

Because the middleware calls `next()` (rather than returning a 404) whenever it
can't serve a file, a missing asset is handled by your routes, not by the static
server. That's what lets a client-side app fall back to an SPA catch-all route.

## Options

```ts
serveStatic({
  root: "./public",        // directory to serve
  index: "index.html",     // directory index file
  dotFiles: "ignore",      // "ignore" (404) · "deny" (403) · "allow"
  maxAge: 86400,           // Cache-Control: public, max-age=…
  immutable: true,         // add the immutable directive (hashed filenames)
  headers: (path) =>       // extra per-file headers
    path.endsWith(".html") ? { "X-Frame-Options": "DENY" } : undefined,
});
```

Every response carries an `ETag` and `Last-Modified`, and a matching
`If-None-Match` returns a `304`. Dot-files (`.env`, `.git`) are 404'd by default
so secrets aren't exposed. Path traversal (`..`) is blocked.

## Caching & conditional requests

The `ETag` is **weak** — derived from the file's byte size and modified time
(`W/"<size>-<mtime>"`) — so it changes whenever the file changes without hashing
its contents. On a repeat request the browser echoes it back in `If-None-Match`;
if it still matches, the middleware short-circuits with `304 Not Modified` and an
empty body, saving the read and the transfer.

`Cache-Control` is only sent when you set `maxAge`; omit it and the response has
no `Cache-Control` header at all (the browser falls back to its heuristic
freshness). Add `immutable: true` for content-hashed filenames so conditional
revalidation is skipped entirely for the cache lifetime:

```ts
// Long-lived, fingerprinted build assets: cache hard, never revalidate.
this.use(serveStatic({ root: "./dist", maxAge: 31536000, immutable: true }));
```

`HEAD` requests get the full header set with an empty body, so clients can probe
an asset's `ETag`/`Last-Modified` without downloading it.

## Per-file headers

The `headers` callback runs for every file about to be served and merges its
result into the response. It receives the **resolved filesystem path** (root
included, e.g. `./public/app.js`), not the URL path — match on the extension or
suffix rather than a leading slash:

```ts
serveStatic({
  headers: (path) => {
    if (path.endsWith(".html")) return { "X-Frame-Options": "DENY" };
    if (path.endsWith(".wasm")) return { "Cross-Origin-Embedder-Policy": "require-corp" };
    return undefined; // no extra headers
  },
});
```

Returning `undefined` (or an empty object) adds nothing. These headers are set
after the built-ins, so a `Cache-Control` you return here overrides the one
derived from `maxAge`.

## Dot-files & traversal

Any path segment that starts with `.` — not just the last one — is a "dot
segment", so `/.git/config` and `/assets/.env` both trip the policy:

- `"ignore"` (default) — falls through to your routes, so it reads as a 404.
- `"deny"` — responds `403 Forbidden`.
- `"allow"` — serves the file like any other.

Separately, any decoded path containing `..` is always rejected regardless of the
dot-file policy, so `../` traversal can't escape `root`.

## Error behavior

The file-resolution block is wrapped in a `try/catch` that swallows errors by
calling `next()`. A permission error, a mid-request delete, or a malformed path
never becomes a `500` — it falls through to your routes exactly like a miss. The
trade-off: genuine filesystem faults are invisible here, so don't rely on this
middleware to surface disk problems.

## Edge note

`serveStatic()` reads from the filesystem (via a dynamically-imported `node:fs`),
so it's for **Node** apps. On Cloudflare Workers, serve assets through the
platform's static-assets binding instead — the framework core still imports
cleanly either way (the `node:fs` import is deferred until the first request the
middleware actually handles).

## Production

For high-traffic sites, prefer a CDN or reverse proxy (Nginx, Caddy, Cloudflare)
in front of static assets rather than serving them from the Node process.

---

## API reference

### `serveStatic(options?)`

`serveStatic(options?: StaticOptions): MiddlewareHandler`

Builds a Hono middleware that serves files from `options.root` before the request
reaches your routes, falling through to `next()` on any miss.

```ts
import { serveStatic } from "@shaferllc/keel/core";

const assets = serveStatic({ root: "./public", maxAge: 86400 });
this.use(assets);
```

**Notes:** all options are optional (`serveStatic()` serves `./public`). Only
`GET`/`HEAD` are handled — other methods pass through untouched. Returns the
middleware synchronously; `node:fs/promises` is imported lazily on the first
handled request, so importing this on a non-Node runtime is safe until a request
hits it. Sends `Content-Type` (via Hono's `getMimeType`, defaulting to
`application/octet-stream`), `Last-Modified`, and a weak `ETag`; honors
`If-None-Match` with a `304`. A trailing slash on `root` is stripped. The `..`
guard is a plain substring check, so a (rare) legitimate filename containing `..`
is also rejected.

### Interfaces & types

#### `StaticOptions`

```ts
interface StaticOptions {
  root?: string;
  index?: string;
  dotFiles?: "ignore" | "deny" | "allow";
  maxAge?: number;
  immutable?: boolean;
  headers?: (path: string) => Record<string, string> | undefined;
}
```

The configuration bag for `serveStatic()`. Pass it to tune the served directory,
directory index, dot-file policy, and caching. Every field has a default, so an
empty object (or no argument) is valid.

```ts
const options: StaticOptions = {
  root: "./dist",
  index: "index.html",
  dotFiles: "deny",
  maxAge: 31536000,
  immutable: true,
  headers: (path) => (path.endsWith(".html") ? { "X-Frame-Options": "DENY" } : undefined),
};
serveStatic(options);
```

**Field defaults & behavior:**

- `root` — directory to serve from. Default `"./public"`; trailing slashes are
  stripped.
- `index` — file served for a directory request. Default `"index.html"`.
- `dotFiles` — policy for paths with a `.`-prefixed segment: `"ignore"` (fall
  through, reads as 404), `"deny"` (`403 Forbidden`), or `"allow"` (serve).
  Default `"ignore"`.
- `maxAge` — `Cache-Control: public, max-age=<seconds>`. Omit for no
  `Cache-Control` header at all.
- `immutable` — appends `, immutable` to `Cache-Control` (only meaningful
  alongside `maxAge`). Default `false`.
- `headers` — called with the resolved filesystem path (root included) for each
  served file; return extra headers to merge, or `undefined` for none. These are
  applied last, so they can override the built-in headers.
