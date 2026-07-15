/**
 * A fixed-window rate-limiting middleware. Limits requests per key (the client
 * IP by default) within a time window, and sets the standard `X-RateLimit-*`
 * and `Retry-After` headers.
 *
 *   this.use(rateLimiter({ max: 60, window: 60 }));        // 60 req / minute
 *   router.post("/login", handler).use(rateLimiter({ max: 5, window: 60 }));
 *
 * Where the counters live is a pluggable store. The default is in-memory —
 * per process, per isolate — which is exactly as strong as a single-node
 * deploy and no stronger. On anything horizontal, share the tally:
 *
 *   rateLimiter({ max: 60, window: 60, store: redisRateLimitStore() });  // atomic
 *   rateLimiter({ max: 60, window: 60, store: cacheRateLimitStore() });  // any Cache
 *
 * The Redis store counts with INCR, so concurrent requests can't slip past the
 * limit. The cache store works on any `Cache` (database, KV) with a read-
 * modify-write — simultaneous hits can under-count by a request or two, which
 * is almost always fine for traffic shaping and not fine for billing.
 */

import type { Context, MiddlewareHandler } from "hono";

import { Cache } from "./cache.js";
import { Redis, redis } from "./redis.js";
import { cache as appCache } from "./helpers.js";

/** One key's tally within its current window. */
export interface RateLimitBucket {
  count: number;
  /** Epoch ms when the window rolls over. */
  reset: number;
}

/** Where the counters live — implement `hit` once per backend. */
export interface RateLimitStore {
  /** Record a hit against `key`, rotating its window if it lapsed; return the tally. */
  hit(key: string, windowMs: number): Promise<RateLimitBucket> | RateLimitBucket;
}

/** The default per-process store. */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitBucket>();

  hit(key: string, windowMs: number): RateLimitBucket {
    const now = Date.now();

    // Occasionally prune expired buckets to bound memory.
    if (this.buckets.size > 10_000) {
      for (const [k, b] of this.buckets) if (b.reset <= now) this.buckets.delete(k);
    }

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    return bucket;
  }
}

/**
 * Count in Redis with INCR — atomic, so a burst across many nodes can't
 * slip past the limit. The counter key expires with its window.
 */
export function redisRateLimitStore(client: Redis = redis()): RateLimitStore {
  return {
    async hit(key, windowMs) {
      const counter = `ratelimit:${key}`;
      const count = await client.incr(counter);
      if (count === 1) await client.expire(counter, Math.ceil(windowMs / 1000));
      const ttl = await client.ttl(counter);
      const reset = Date.now() + (ttl > 0 ? ttl * 1000 : windowMs);
      return { count, reset };
    },
  };
}

/**
 * Count through a `Cache` — whatever store backs it (database, KV) becomes the
 * shared tally. Read-modify-write, so simultaneous hits can under-count
 * slightly; prefer the Redis store when the limit is a hard promise.
 */
export function cacheRateLimitStore(store?: Cache): RateLimitStore {
  return {
    async hit(key, windowMs) {
      const c = store ?? appCache();
      const now = Date.now();
      const cacheKey = `ratelimit:${key}`;

      let bucket = await c.get<RateLimitBucket | undefined>(cacheKey);
      if (!bucket || bucket.reset <= now) bucket = { count: 0, reset: now + windowMs };
      bucket.count++;
      await c.put(cacheKey, bucket, Math.ceil((bucket.reset - now) / 1000));
      return bucket;
    },
  };
}

export interface RateLimiterOptions {
  /** Max requests allowed per window. Default: 60. */
  max?: number;
  /** Window length in seconds. Default: 60. */
  window?: number;
  /** Derive the bucket key from the request. Default: client IP. */
  key?: (c: Context) => string;
  /** Response message on 429. */
  message?: string;
  /** Where the counters live. Default: a per-process `MemoryRateLimitStore`. */
  store?: RateLimitStore;
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
  const store = options.store ?? new MemoryRateLimitStore();

  return async (c, next) => {
    const bucket = await store.hit(keyFor(c), windowMs);
    const remaining = Math.max(0, max - bucket.count);

    const resetSeconds = Math.ceil(bucket.reset / 1000);
    if (bucket.count > max) {
      return c.json({ error: options.message ?? "Too Many Requests", status: 429 }, 429, {
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(Math.max(1, Math.ceil((bucket.reset - Date.now()) / 1000))),
      });
    }

    await next();
    // Set headers on the final response (survives any handler type).
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetSeconds));
  };
}
