# Rate Limiting

`rateLimiter()` is a middleware that caps how many requests a client can make in
a window. It sets the standard `X-RateLimit-*` and `Retry-After` headers, and
returns `429 Too Many Requests` when the limit is exceeded.

It's a **fixed-window** limiter: each key gets a bucket that counts requests
until a fixed reset time, then starts over. Simple, cheap, and edge-safe — the
default store is a plain in-memory `Map`, so nothing is imported that can't run
on a Worker.

## Global or per-route

```ts
import { rateLimiter } from "@shaferllc/keel/core";

// every request: 60 per minute per IP
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(rateLimiter({ max: 60, window: 60 }));
  }
}

// a stricter limit on a sensitive route
router.post("/login", [AuthController, "login"]).use(rateLimiter({ max: 5, window: 60 }));
```

Each call to `rateLimiter()` owns its own bucket store, so a global limiter and a
per-route limiter count independently — a request to `/login` ticks both, but in
separate buckets. Stack as many as you like.

## Options

```ts
rateLimiter({
  max: 60,                     // requests per window (default 60)
  window: 60,                  // window seconds (default 60)
  key: (c) => c.req.header("x-api-key") ?? "anon", // bucket key (default: IP)
  message: "Slow down!",       // 429 body message
});
```

The `key` function decides what to limit by — per IP (default), per API key, per
user id, etc. Different keys get independent buckets. Return the same string to
share a bucket; return `"global"` (or any constant) to limit everyone together.

### The default key

With no `key`, the bucket is derived from the client IP, tried in this order:

1. the first entry of `X-Forwarded-For` (trimmed),
2. `X-Real-IP`,
3. the literal `"global"` if neither header is present.

That fallback means that behind a proxy that strips those headers, *every* client
shares the `"global"` bucket — so set an explicit `key` if your platform doesn't
surface the client IP.

## Response headers

Every response carries:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | the ceiling for the window |
| `X-RateLimit-Remaining` | requests left in the window |
| `Retry-After` | (on 429) seconds until the window resets |

On an allowed request the two `X-RateLimit-*` headers are written *after* the
handler runs. On a rejected request all three are set on the `429` itself.

## What happens at the limit

The counter increments on every request. The request that pushes the count
*past* `max` is the one that's rejected — so `max: 5` lets five requests through
and blocks the sixth within the window. The `429` body is:

```json
{ "error": "Too Many Requests", "status": 429 }
```

`error` is your `message` if you passed one. `Retry-After` reports the whole
seconds until the bucket resets. Once the window elapses the next request starts
a fresh bucket at count 1.

## Storage

The default store is **in-memory** — per process, and per isolate on the edge.
That's fine for a single instance, but limits aren't shared across instances.
The store self-prunes: once it holds more than 10,000 keys it sweeps expired
buckets on the next request, so a large key space (e.g. per-IP) won't grow
unbounded.

For distributed limiting, wrap your own middleware that counts in Redis/KV and
returns `429` the same way.

---

## API reference

### `rateLimiter(options?)`

`rateLimiter(options?: RateLimiterOptions): MiddlewareHandler`

Builds a fixed-window rate-limiting middleware. Each returned handler keeps its
own private bucket store, counts requests per key within the window, sets the
`X-RateLimit-*` headers, and short-circuits with `429` past the limit.

```ts
import { rateLimiter } from "@shaferllc/keel/core";

const limit = rateLimiter({ max: 100, window: 60 });
// register it: this.use(limit) globally, or .use(limit) on a route
```

**Notes:** all options are optional — `rateLimiter()` with no arguments is 60
requests per 60 seconds, keyed by client IP. The returned handler is a Hono
`MiddlewareHandler`, so it works anywhere middleware is accepted (`use`, per
route, per group). Buckets live in a closure over the single call, so reusing the
*same* handler shares state while a second `rateLimiter(...)` call does not.
The `429` is returned before `next()`, so downstream handlers never run for a
throttled request.

### Interfaces & types

#### `RateLimiterOptions`

```ts
interface RateLimiterOptions {
  max?: number;                     // requests per window; default 60
  window?: number;                  // window length in seconds; default 60
  key?: (c: Context) => string;     // bucket key; default: client IP
  message?: string;                 // 429 body message; default "Too Many Requests"
}
```

The shape you pass to `rateLimiter()`. Every field is optional; `key` receives the
Hono `Context` and returns the string that identifies the bucket.

```ts
import { rateLimiter, type RateLimiterOptions } from "@shaferllc/keel/core";

const perUser: RateLimiterOptions = {
  max: 30,
  window: 60,
  key: (c) => c.req.header("authorization") ?? "anon",
  message: "Easy there — try again shortly.",
};
rateLimiter(perUser);
```

**Notes:** `window` is **seconds**, not milliseconds (it's multiplied by 1000
internally). `key` is called on every request, so keep it cheap and pure. Returning
a constant string collapses all clients into one shared bucket.
