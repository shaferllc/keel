/**
 * A fixed-window rate-limiting middleware. Limits requests per key (the client
 * IP by default) within a time window, and sets the standard `X-RateLimit-*`
 * and `Retry-After` headers.
 *
 *   this.use(rateLimiter({ max: 60, window: 60 }));        // 60 req / minute
 *   router.post("/login", handler).use(rateLimiter({ max: 5, window: 60 }));
 *
 * The default store is in-memory (per process / per isolate). For distributed
 * limiting, pass a store backed by Redis/KV.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface RateLimiterOptions {
  /** Max requests allowed per window. Default: 60. */
  max?: number;
  /** Window length in seconds. Default: 60. */
  window?: number;
  /** Derive the bucket key from the request. Default: client IP. */
  key?: (c: Context) => string;
  /** Response message on 429. */
  message?: string;
}

function defaultKey(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "global"
  );
}

export function rateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler {
  const max = options.max ?? 60;
  const windowMs = (options.window ?? 60) * 1000;
  const keyFor = options.key ?? defaultKey;
  const buckets = new Map<string, { count: number; reset: number }>();

  return async (c, next) => {
    const now = Date.now();
    const key = keyFor(c);

    // Occasionally prune expired buckets to bound memory.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, max - bucket.count);

    const resetSeconds = Math.ceil(bucket.reset / 1000);
    if (bucket.count > max) {
      return c.json({ error: options.message ?? "Too Many Requests", status: 429 }, 429, {
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(Math.ceil((bucket.reset - now) / 1000)),
      });
    }

    await next();
    // Set headers on the final response (survives any handler type).
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetSeconds));
  };
}
