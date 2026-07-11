# Redis

A Redis integration built on a small pluggable driver — like the database and
mail layers, the core imports no client, so it runs on Node and on the edge.
Point it at Upstash (HTTP/`fetch`), ioredis, node-redis, or the built-in
`MemoryRedis` for tests and local dev.

## Using it

Register a driver once (in a service provider), then reach Redis anywhere with
`redis()`:

```ts
import { redis, setRedis, MemoryRedis } from "@shaferllc/keel/core";

setRedis(new MemoryRedis()); // swap for an Upstash / ioredis adapter in production

await redis().set("views", "1");
await redis().incr("views");            // 2
await redis().get("views");             // "2"
await redis().set("token", "abc", { ex: 60 }); // expire in 60s
await redis().del("token");
```

The default client is a `MemoryRedis`, so `redis()` works out of the box in
tests without any setup.

## Commands

```ts
const r = redis();

await r.get(key);                 // string | null
await r.set(key, value, { ex });  // { ex: seconds } or { px: ms }
await r.del(...keys);             // number removed
await r.exists(...keys);          // number present
await r.has(key);                 // boolean

await r.incr(key);                // +1
await r.decr(key);                // -1
await r.incrBy(key, 5);

await r.expire(key, 60);          // set a TTL (seconds)
await r.ttl(key);                 // seconds left, -1 (no expiry), -2 (no key)
await r.keys("user:*");           // glob match
await r.flushAll();               // clear everything
```

### JSON & remember

`getJson` / `setJson` handle serialization, and `remember` is the read-through
cache pattern:

```ts
await redis().setJson("user:1", { id: 1, name: "Ada" });
const user = await redis().getJson<{ id: number; name: string }>("user:1");

// Compute once, cache for 300s, serve from cache after:
const stats = await redis().remember("stats", 300, () => computeStats());
```

## As a cache store

`redisStore()` adapts the Redis client into a [`CacheStore`](./cache.md), so the
cache can be Redis-backed — shared across instances instead of per-process:

```ts
import { Cache, redisStore, redis } from "@shaferllc/keel/core";

const cache = new Cache(redisStore(redis()));
await cache.remember("home", 60, () => renderHome());
```

## Writing a driver

A driver is the `RedisConnection` interface. Here's the shape for an Upstash
REST client over `fetch` (edge-safe):

```ts
import type { RedisConnection } from "@shaferllc/keel/core";

const upstash = (url: string, token: string): RedisConnection => {
  const call = (...args: (string | number)[]) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    }).then((r) => r.json());
  return {
    async get(key) { return (await call("GET", key)).result ?? null; },
    async set(key, value, o) {
      await (o?.ex ? call("SET", key, value, "EX", o.ex) : call("SET", key, value));
    },
    async del(...keys) { return (await call("DEL", ...keys)).result; },
    async exists(...keys) { return (await call("EXISTS", ...keys)).result; },
    async incrBy(key, n) { return (await call("INCRBY", key, n)).result; },
    async expire(key, s) { return (await call("EXPIRE", key, s)).result === 1; },
    async ttl(key) { return (await call("TTL", key)).result; },
    async keys(pattern) { return (await call("KEYS", pattern)).result; },
    async flushAll() { await call("FLUSHALL"); },
  };
};
setRedis(upstash(env("UPSTASH_URL"), env("UPSTASH_TOKEN")));
```

## In tests

`MemoryRedis` is a full in-memory implementation with TTL support — no server:

```ts
import { setRedis, MemoryRedis, redis } from "@shaferllc/keel/core";

setRedis(new MemoryRedis());
await redis().incr("signups");
assert.equal(await redis().get("signups"), "1");
```

## API reference

### `redis()`

`redis(): Redis`

The default client. Register a driver with `setRedis` first; defaults to a
`MemoryRedis`.

### `setRedis(conn)`

`setRedis(conn: RedisConnection): Redis`

Registers the driver behind `redis()` and returns the wrapping client. Last call
wins.

### `Redis`

Wraps a `RedisConnection` with conveniences.

| Method | Signature | Notes |
|--------|-----------|-------|
| `get` | `(key) => Promise<string \| null>` | raw string value |
| `set` | `(key, value, options?) => Promise<void>` | `{ ex: seconds }` / `{ px: ms }` |
| `del` / `exists` | `(...keys) => Promise<number>` | count removed / present |
| `has` | `(key) => Promise<boolean>` | `exists(key) > 0` |
| `incr` / `decr` | `(key) => Promise<number>` | ±1 |
| `incrBy` | `(key, amount) => Promise<number>` | atomic add |
| `expire` | `(key, seconds) => Promise<boolean>` | false if the key is gone |
| `ttl` | `(key) => Promise<number>` | seconds, `-1` no expiry, `-2` no key |
| `keys` | `(pattern?) => Promise<string[]>` | glob; default `"*"` |
| `flushAll` | `() => Promise<void>` | clear all |
| `getJson` / `setJson` | JSON convenience over `get`/`set` | |
| `remember` | `(key, seconds, factory) => Promise<T>` | read-through cache |

### `MemoryRedis`

`class MemoryRedis implements RedisConnection`

An in-memory driver with TTL support — the default and ideal for tests. Not
shared across processes.

### `redisStore(client?)`

`redisStore(client?: Redis): CacheStore`

Adapts a `Redis` client into a `CacheStore` for the cache layer. Defaults to the
global `redis()`.

### Interfaces & types

#### `RedisConnection`

The driver seam — implement it to back Redis with any client. Methods: `get`,
`set`, `del`, `exists`, `incrBy`, `expire`, `ttl`, `keys`, `flushAll`.

#### `SetOptions`

`interface SetOptions { ex?: number; px?: number }`

Expiry for `set` — `ex` in seconds, `px` in milliseconds.
