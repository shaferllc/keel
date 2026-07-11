/**
 * Redis integration. Like the database and mail layers, it's built on a small
 * pluggable driver (`RedisConnection`) rather than a hard dependency — so the
 * core imports no client and runs on Node and the edge. Point it at Upstash
 * (HTTP/`fetch`), ioredis, node-redis, or the built-in `MemoryRedis` for tests.
 *
 *   setRedis(new MemoryRedis());          // or an Upstash/ioredis adapter
 *   await redis().set("views", "1");
 *   await redis().incr("views");          // 2
 *   await redis().remember("user:1", 60, () => fetchUser(1));
 *
 * `Redis` adds JSON helpers and a `remember` cache pattern over the raw command
 * seam; `redisStore()` exposes it as a `CacheStore` so the cache can be
 * Redis-backed.
 */

import type { CacheStore } from "./cache.js";

export interface SetOptions {
  /** Expire after N seconds. */
  ex?: number;
  /** Expire after N milliseconds. */
  px?: number;
}

/** The bridge to your Redis client — implement it once per driver. */
export interface RedisConnection {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<void>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  incrBy(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushAll(): Promise<void>;
}

/* ------------------------------ memory driver ----------------------------- */

/** An in-memory `RedisConnection` with TTL support — the default; ideal for tests. */
export class MemoryRedis implements RedisConnection {
  private store = new Map<string, { value: string; expires: number }>();

  private live(key: string): { value: string; expires: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, options?: SetOptions): Promise<void> {
    const ms = options?.px ?? (options?.ex != null ? options.ex * 1000 : 0);
    this.store.set(key, { value, expires: ms ? Date.now() + ms : 0 });
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.store.delete(key)) n++;
    return n;
  }

  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.live(key)) n++;
    return n;
  }

  async incrBy(key: string, amount: number): Promise<number> {
    const current = Number(this.live(key)?.value ?? 0);
    const next = current + amount;
    const expires = this.store.get(key)?.expires ?? 0;
    this.store.set(key, { value: String(next), expires });
    return next;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const entry = this.live(key);
    if (!entry) return false;
    entry.expires = Date.now() + seconds * 1000;
    return true;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2; // no such key
    if (!entry.expires) return -1; // no expiry
    return Math.ceil((entry.expires - Date.now()) / 1000);
  }

  async keys(pattern: string): Promise<string[]> {
    // Glob-ish: translate `*` and `?` to a regex.
    const rx = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    const out: string[] = [];
    for (const key of this.store.keys()) if (this.live(key) && rx.test(key)) out.push(key);
    return out;
  }

  async flushAll(): Promise<void> {
    this.store.clear();
  }
}

/* -------------------------------- the client ------------------------------ */

export class Redis {
  constructor(private conn: RedisConnection) {}

  get(key: string): Promise<string | null> {
    return this.conn.get(key);
  }
  set(key: string, value: string, options?: SetOptions): Promise<void> {
    return this.conn.set(key, value, options);
  }
  del(...keys: string[]): Promise<number> {
    return this.conn.del(...keys);
  }
  exists(...keys: string[]): Promise<number> {
    return this.conn.exists(...keys);
  }
  async has(key: string): Promise<boolean> {
    return (await this.conn.exists(key)) > 0;
  }
  incr(key: string): Promise<number> {
    return this.conn.incrBy(key, 1);
  }
  decr(key: string): Promise<number> {
    return this.conn.incrBy(key, -1);
  }
  incrBy(key: string, amount: number): Promise<number> {
    return this.conn.incrBy(key, amount);
  }
  expire(key: string, seconds: number): Promise<boolean> {
    return this.conn.expire(key, seconds);
  }
  ttl(key: string): Promise<number> {
    return this.conn.ttl(key);
  }
  keys(pattern = "*"): Promise<string[]> {
    return this.conn.keys(pattern);
  }
  flushAll(): Promise<void> {
    return this.conn.flushAll();
  }

  /** Get a JSON value (parsed), or null if the key is unset. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.conn.get(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  }

  /** Set a value as JSON. */
  setJson(key: string, value: unknown, options?: SetOptions): Promise<void> {
    return this.conn.set(key, JSON.stringify(value), options);
  }

  /** Return the cached JSON value, or compute it, store it for `seconds`, and return it. */
  async remember<T>(key: string, seconds: number, factory: () => T | Promise<T>): Promise<T> {
    const hit = await this.getJson<T>(key);
    if (hit !== null) return hit;
    const fresh = await factory();
    await this.setJson(key, fresh, { ex: seconds });
    return fresh;
  }

  /** The underlying driver, for raw access. */
  get connection(): RedisConnection {
    return this.conn;
  }
}

/* ----------------------------- cache adapter ------------------------------ */

/** Expose a `Redis` client as a `CacheStore`, so the cache can be Redis-backed. */
export function redisStore(client: Redis = redis()): CacheStore {
  return {
    // The cache treats `undefined` as "miss"; Redis has no such value, so map it.
    get: async (key) => (await client.getJson(key)) ?? undefined,
    set: async (key, value, ttlMs) => {
      await client.setJson(key, value, ttlMs ? { px: ttlMs } : undefined);
    },
    delete: async (key) => {
      await client.del(key);
    },
    clear: () => client.flushAll(),
  };
}

/* -------------------------------- global ---------------------------------- */

let client = new Redis(new MemoryRedis());

/** Register the default Redis driver used by `redis()`. */
export function setRedis(conn: RedisConnection): Redis {
  client = new Redis(conn);
  return client;
}

/** The default Redis client. */
export function redis(): Redis {
  return client;
}
