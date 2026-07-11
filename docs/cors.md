# CORS

Cross-Origin Resource Sharing lets browsers on other origins call your API. The
`cors()` middleware sets the `Access-Control-*` headers and answers preflight
`OPTIONS` requests for you.

## Enabling

Register it in your [HTTP kernel](./middleware.md) (app-wide) or on a route group:

```ts
import { cors } from "@shaferllc/keel/core";

// In the kernel — applies to every route
this.use(cors());

// Or scoped to an API group
router.group(() => { /* … */ }).use(cors({ origin: ["https://app.example.com"] }));
```

With no options, `cors()` reflects the caller's origin — convenient in
development. **Lock it down in production** with an explicit allowlist.

## Options

```ts
cors({
  origin: ["https://app.example.com"], // true (reflect) | false | "*" | string[] | (origin, c) => …
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  headers: true,                        // true (reflect requested) | string[]
  exposeHeaders: ["X-Request-Id"],      // response headers JS may read
  credentials: true,                    // send Access-Control-Allow-Credentials
  maxAge: 86400,                        // preflight cache seconds; null to omit
});
```

- **`origin`** — `true` reflects the request origin, `false` blocks everything,
  `"*"` allows any, an array is an allowlist, and a `(origin, c) => …` predicate
  returns `true`/`false`/a specific origin for dynamic decisions (e.g. any
  `localhost` port in dev).
- **`credentials`** — when on, the spec forbids `"*"`, so `cors()` automatically
  reflects the concrete origin and adds `Vary: Origin`.
- **`headers`** — `true` echoes whatever the browser asks for in the preflight;
  an array pins an explicit allowlist.

## Preflight

Browsers send an `OPTIONS` request with `Access-Control-Request-Method` before
certain cross-origin calls. `cors()` detects these and responds `204` with the
allow headers directly — your route never runs. Everything else falls through to
your handler with the CORS response headers attached.
