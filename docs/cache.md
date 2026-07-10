# Cache

A small cache with TTLs and the `remember` pattern. Memory-backed by default
(per-process, or per-isolate on the edge), with a pluggable store so you can
swap in Redis, KV, or anything else. Reach it with the global `cache()` helper.

## Basics

```ts
import { cache } from "@shaferllc/keel/core";

await cache().put("user:1", user);          // forever
await cache().put("otp", code, 300);        // expires in 300s
await cache().get("user:1");
await cache().get("missing", fallback);
await cache().has("otp");
await cache().forget("otp");
await cache().pull("otp");                   // get + forget
await cache().flush();                        // clear everything
```

## remember

The common pattern — return the cached value, or compute, cache, and return it:

```ts
const stats = await cache().remember("dashboard.stats", 60, async () => {
  return computeExpensiveStats(); // runs only on a cache miss
});

const config = await cache().rememberForever("app.config", () => loadConfig());
```

## Custom stores

The default is in-memory. To persist elsewhere, implement `CacheStore` and bind
your own `Cache` in a provider:

```ts
import { Cache, singleton, type CacheStore } from "@shaferllc/keel/core";

class RedisStore implements CacheStore {
  async get(key) { /* … */ }
  async set(key, value, ttlMs) { /* … */ }
  async delete(key) { /* … */ }
  async clear() { /* … */ }
}

singleton(Cache, () => new Cache(new RedisStore()));
```

## Notes

- The in-memory store is ephemeral: it clears on restart and isn't shared across
  processes or Worker isolates. Use a custom store for anything durable or
  shared.
- Every method is async, so the same code works whether the store is in-memory
  or over the network.
