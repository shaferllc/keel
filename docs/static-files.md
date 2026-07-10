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

## Edge note

`serveStatic()` reads from the filesystem (via a dynamically-imported `node:fs`),
so it's for **Node** apps. On Cloudflare Workers, serve assets through the
platform's static-assets binding instead — the framework core still imports
cleanly either way.

## Production

For high-traffic sites, prefer a CDN or reverse proxy (Nginx, Caddy, Cloudflare)
in front of static assets rather than serving them from the Node process.
