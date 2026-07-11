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

`put` takes a TTL in **seconds** (converted to milliseconds for the store);
omit it to cache forever. `get` returns `undefined` on a miss unless you pass a
fallback, in which case the fallback comes back instead — it's only returned,
never written to the cache.

## remember

The common pattern — return the cached value, or compute, cache, and return it:

```ts
const stats = await cache().remember("dashboard.stats", 60, async () => {
  return computeExpensiveStats(); // runs only on a cache miss
});

const config = await cache().rememberForever("app.config", () => loadConfig());
```

The factory runs **only on a miss**. On a hit the cached value is returned and
the factory is never called, so it's the right place for an expensive query, an
upstream API call, or anything you'd rather do once per TTL window. The factory
may be sync or async — both are awaited.

## Read-through, then invalidate

`pull` reads and forgets in one step — handy for one-shot values like a
password-reset token or a flash message you want to survive exactly one read:

```ts
const token = await cache().pull<string>("reset:jane", ""); // read, then delete
```

Pair `remember` with `forget` to invalidate a derived value when its inputs
change:

```ts
await db("users").where("id", id).update({ name });
await cache().forget(`user:${id}`);          // next read recomputes
```

## TTLs and expiry

TTLs are lazy in the memory store: an expired entry isn't purged on a timer, it's
dropped the next time you `get` (or `has`) it. So an untouched expired key still
occupies memory until it's read again or you `flush()`. A `ttlSeconds` of `0` (or
omitted) means no expiry — the entry lives until it's forgotten or flushed.

```ts
await cache().put("otp", code, 300);   // gone 300s after this write
await cache().put("app.config", cfg);  // no TTL — lives until forgotten
```

## Custom stores

The default is in-memory. To persist elsewhere, implement `CacheStore` and bind
your own `Cache` in a provider:

```ts
import { Cache, singleton, type CacheStore } from "@shaferllc/keel/core";

class RedisStore implements CacheStore {
  async get(key: string) { /* … */ }
  async set(key: string, value: unknown, ttlMs?: number) { /* … */ }
  async delete(key: string) { /* … */ }
  async clear() { /* … */ }
}

singleton(Cache, () => new Cache(new RedisStore()));
```

The store speaks **milliseconds** (`ttlMs`), while the `Cache` façade takes
seconds — `Cache` does the conversion, so your store never sees the seconds unit.
Every `CacheStore` method may return a value or a promise; `Cache` awaits both,
so a synchronous in-memory store and an async network store are interchangeable
behind the same API.

## Notes

- The in-memory store is ephemeral: it clears on restart and isn't shared across
  processes or Worker isolates. Use a custom store for anything durable or
  shared.
- Every `Cache` method is async, so the same code works whether the store is
  in-memory or over the network.
- Cache keys are plain strings — namespace them yourself (`user:1`,
  `dashboard.stats`) to avoid collisions.

## Related

`cache()` resolves the `Cache` singleton out of the application container, the
same way `config()` and `logger()` reach their services.

---

## API reference

### `cache()`

`cache(): Cache`

Resolves the application's `Cache` singleton from the container — the global
entry point used everywhere else on this page.

```ts
import { cache } from "@shaferllc/keel/core";

await cache().put("user:1", user);
```

**Notes:** throws if no `Application` has been bootstrapped (it goes through
`app()` internally). The instance is a singleton, so every call returns the same
`Cache` — bind a replacement with `singleton(Cache, …)` to swap the store.

### `Cache`

The cache façade. Construct it with a `CacheStore` (defaults to `MemoryStore`),
or reach the app-bound instance with `cache()`. Every method is async and awaits
the underlying store.

```ts
import { Cache, MemoryStore } from "@shaferllc/keel/core";

const c = new Cache();                  // MemoryStore by default
const r = new Cache(new MemoryStore()); // explicit store
```

#### `get(key, fallback?)`

`get<T = unknown>(key: string, fallback?: T): Promise<T>`

Reads a value, returning `fallback` (or `undefined`) when the key is missing.

```ts
const user = await cache().get<User>("user:1");
const port = await cache().get("app.port", 3000); // 3000 on a miss
```

**Notes:** a miss is detected by `=== undefined`, so a stored `null`, `0`, `""`,
or `false` counts as a hit and is returned as-is. The `fallback` is only returned,
never written back to the cache. The type parameter `T` is a compile-time
convenience — the value isn't validated at runtime.

#### `put(key, value, ttlSeconds?)`

`put(key: string, value: unknown, ttlSeconds?: number): Promise<void>`

Stores a value, optionally expiring it after `ttlSeconds`.

```ts
await cache().put("otp", code, 300); // expires in 5 minutes
await cache().put("user:1", user);   // no TTL — cached forever
```

**Notes:** `ttlSeconds` is **seconds** and is converted to milliseconds for the
store. Omitting it (or passing `0`) means no expiry. Overwrites any existing value
at `key`.

#### `has(key)`

`has(key: string): Promise<boolean>`

`true` when a live (non-expired) value exists at `key`.

```ts
if (await cache().has("otp")) { /* still valid */ }
```

**Notes:** reads through the store, so in the memory store it also triggers the
lazy purge of an expired entry. A stored `undefined` reads as absent.

#### `forget(key)`

`forget(key: string): Promise<void>`

Removes a single key.

```ts
await cache().forget("user:1"); // next read recomputes
```

**Notes:** a no-op if the key isn't present — never throws on a miss.

#### `pull(key, fallback?)`

`pull<T = unknown>(key: string, fallback?: T): Promise<T>`

Reads a value and forgets it in one step — a `get` followed by a `forget`.

```ts
const token = await cache().pull<string>("reset:jane", "");
```

**Notes:** returns `fallback` (or `undefined`) on a miss, then still calls
`forget` (harmless). Use it for single-use values like one-time tokens or flash
messages.

#### `flush()`

`flush(): Promise<void>`

Clears the entire cache.

```ts
await cache().flush();
```

**Notes:** delegates to the store's `clear()` — wipes every key, not just the
ones you set through this `Cache`. In a shared store that's every consumer's keys.

#### `remember(key, ttlSeconds, factory)`

`remember<T>(key: string, ttlSeconds: number, factory: () => T | Promise<T>): Promise<T>`

Returns the cached value, or runs `factory`, caches its result for `ttlSeconds`,
and returns it.

```ts
const stats = await cache().remember("dashboard.stats", 60, () =>
  computeExpensiveStats(),
);
```

**Notes:** `factory` runs **only on a miss** and may be sync or async (both are
awaited). A stored `undefined` is treated as a miss, so `factory` re-runs. The
`ttlSeconds` argument is required here (unlike `put`); use `rememberForever` for
no expiry.

#### `rememberForever(key, factory)`

`rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T>`

Like `remember`, but caches with no TTL.

```ts
const config = await cache().rememberForever("app.config", () => loadConfig());
```

**Notes:** same miss semantics as `remember` — `factory` runs once, then the
value is served until it's forgotten or flushed.

### `MemoryStore`

The default `CacheStore` — an in-process `Map` with lazy TTL expiry. Used
automatically when you construct a `Cache` with no store; construct it directly
only to pass it explicitly or to inspect it in tests.

```ts
import { Cache, MemoryStore } from "@shaferllc/keel/core";

const c = new Cache(new MemoryStore());
```

#### `get(key)`

`get(key: string): unknown`

Returns the stored value, or `undefined` if absent or expired.

```ts
const store = new MemoryStore();
store.set("k", 1, 1000);
store.get("k"); // 1
```

**Notes:** synchronous. Expiry is checked on read — an expired entry is deleted
in-line and returns `undefined`, so `get` is what actually purges stale keys.

#### `set(key, value, ttlMs?)`

`set(key: string, value: unknown, ttlMs?: number): void`

Stores a value with an optional TTL in **milliseconds**.

```ts
store.set("otp", code, 300_000); // 5 minutes
store.set("cfg", config);        // no expiry
```

**Notes:** synchronous, and takes `ttlMs` (milliseconds), not seconds — the
`Cache` façade does the seconds→ms conversion before calling this. Omitting
`ttlMs` (or `0`) stores with `expires: 0`, meaning no expiry.

#### `delete(key)`

`delete(key: string): void`

Removes a single key. Synchronous; a no-op if absent.

```ts
store.delete("otp");
```

#### `clear()`

`clear(): void`

Empties the whole map. Synchronous.

```ts
store.clear();
```

### Interfaces & types

#### `CacheStore`

```ts
interface CacheStore {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown, ttlMs?: number): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}
```

The seam between `Cache` and its backing store. Implement it to persist
elsewhere (Redis, Cloudflare KV, a database) and bind a `Cache` around it. Each
method may return synchronously or as a promise — `Cache` awaits either, so a
plain in-memory map and an async network client satisfy the same interface.

```ts
import { Cache, singleton, type CacheStore } from "@shaferllc/keel/core";

class KVStore implements CacheStore {
  constructor(private kv: KV) {}
  async get(key: string) {
    return (await this.kv.get(key)) ?? undefined;
  }
  async set(key: string, value: unknown, ttlMs?: number) {
    await this.kv.put(key, JSON.stringify(value), ttlMs);
  }
  async delete(key: string) { await this.kv.delete(key); }
  async clear() { /* KV has no bulk clear — list + delete, or skip */ }
}

singleton(Cache, () => new Cache(new KVStore(kv)));
```

**Notes:** TTLs reach your store in **milliseconds** (`ttlMs`). A missing key must
resolve to `undefined` — that's how `Cache` distinguishes a miss from a stored
value in `get`, `has`, `pull`, and the `remember` family.
