# Rate Limiting

`rateLimiter()` is a middleware that caps how many requests a client can make in
a window. It sets the standard `X-RateLimit-*` and `Retry-After` headers, and
returns `429 Too Many Requests` when the limit is exceeded.

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
user id, etc. Different keys get independent buckets.

## Response headers

Every response carries:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | the ceiling for the window |
| `X-RateLimit-Remaining` | requests left in the window |
| `Retry-After` | (on 429) seconds until the window resets |

## Storage

The default store is **in-memory** — per process, and per isolate on the edge.
That's fine for a single instance, but limits aren't shared across instances.
For distributed limiting, wrap your own middleware that counts in Redis/KV and
returns `429` the same way.
