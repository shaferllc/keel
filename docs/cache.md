# Cache

A small cache with TTLs and the `remember` pattern. Memory-backed by default
(per-process, or per-isolate on the edge), with a pluggable store so you can
swap in Redis, KV, or anything else. Reach it with the global `cache()` helper.

## Basics

```ts
import { cache } from "@shaferllc/keel/core";

await cache().put("user:1", user);          // forever
await cache().put("otp", code, 300);        // expires in 300s
await cache().add("otp", code, 300);        // write only if absent → boolean
await cache().get("user:1");
await cache().get("missing", fallback);
await cache().has("otp");
await cache().missing("otp");                // the inverse of has
await cache().forget("otp");
await cache().forgetMany(["otp", "user:1"]); // forget several
await cache().pull("otp");                   // get + forget
await cache().flush();                        // clear everything
```

`put` takes a TTL in **seconds** (converted to milliseconds for the store);
omit it to cache forever. `get` returns `undefined` on a miss unless you pass a
fallback, in which case the fallback comes back instead — it's only returned,
never written to the cache. `add` writes only when the key is absent and returns
whether it did — a lightweight "claim this key" for one-shot work.

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

### Stampede protection

When a hot key expires, many requests can hit the miss at once and each run the
factory — a "cache stampede" that hammers the thing you were trying to protect.
`remember` guards against this automatically: **concurrent calls for the same
key share a single factory run** and all receive its result. You don't opt in;
it's just how `remember` and `rememberForever` behave.

```ts
// 100 concurrent requests, one cold key → the query runs ONCE.
await Promise.all(
  requests.map(() => cache().remember("report", 300, runExpensiveReport)),
);
```

This is per-isolate (no cross-node lock), which matches keel's single-store
model — it collapses the dog-pile within a process/worker, the case that
actually melts a server.

### Grace: serve stale on error

Pass a `grace` window (seconds) and an expired value is **retained past its TTL**
and served if the refreshing factory throws. A flaky upstream then degrades to
slightly-stale data instead of a hard error:

```ts
const rates = await cache().remember("fx.rates", 60, fetchRates, { grace: 3600 });
// For up to an hour after the 60s TTL lapses, if fetchRates() throws the last
// good rates are returned. A successful refresh replaces them and resets the window.
```

Grace only rescues a *failing* refresh — a normal `get()` on an expired key still
reports a miss, so stale data never leaks through the plain read path. If the
factory succeeds, the fresh value is cached and the grace window restarts.

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

## Tags

When one change should invalidate a *group* of unrelated keys, tag them and drop
the whole group with `deleteByTag`. Pass `tags` on any write:

```ts
await cache().put("post:1", post, 600, { tags: ["posts"] });
await cache().remember("feed:home", 300, buildFeed, { tags: ["posts"] });
await cache().put("post:2", post, 600, { tags: ["posts", "featured"] });

// A new post lands — blow away everything tagged "posts" in one call:
await cache().deleteByTag(["posts"]);
```

`deleteByTag` is **O(number of tags)**, not O(number of keys): each tag carries a
version counter, every entry records the counter it was written at, and
`deleteByTag` just bumps it — so any entry on the old version reads as a miss on
its next access. There's no key scan and nothing to clean up; invalidated
entries fall out on their own TTL. Because it's a hard invalidation, a
tag-dropped entry is **not** grace-eligible — `remember` recomputes it rather
than serving it stale.

## Namespaces

`namespace(prefix)` returns a cache scoped under a key prefix. Keys written
through it live at `prefix:key`, so two namespaces can reuse the same logical key
without colliding — and `flush()` on a namespace clears **only** that namespace,
leaving the rest of the store intact:

```ts
const users = cache().namespace("users");
const posts = cache().namespace("posts");

await users.put("1", user);   // stored at "users:1"
await posts.put("1", post);   // stored at "posts:1" — no collision

await users.flush();          // clears the users namespace only
await posts.get("1");         // still there
```

Namespaces nest (`cache().namespace("org").namespace("team")`) and carry the full
API — `remember`, `grace`, `tags`, everything. Scoped `flush()` uses the same
version-stamp trick as tags (a namespace is an implicit tag), so it's O(1) and
needs no key scanning — the deliberate trade-off is that flushed entries are
invalidated rather than physically removed, and expire on their TTL.

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

#### `put(key, value, ttlSeconds?, options?)`

`put(key: string, value: unknown, ttlSeconds?: number, options?: PutOptions): Promise<void>`

Stores a value, optionally expiring it after `ttlSeconds` and joining it to
`options.tags`.

```ts
await cache().put("otp", code, 300);                          // expires in 5 minutes
await cache().put("user:1", user);                            // no TTL — cached forever
await cache().put("post:1", post, 600, { tags: ["posts"] });  // tagged
```

**Notes:** `ttlSeconds` is **seconds** and is converted to milliseconds for the
store. Omitting it (or passing `0`) means no expiry. Overwrites any existing value
at `key`. `options.tags` associates the entry with those tags for `deleteByTag`.

#### `add(key, value, ttlSeconds?, options?)`

`add(key: string, value: unknown, ttlSeconds?: number, options?: PutOptions): Promise<boolean>`

Stores a value **only if the key is absent**, returning `true` when it wrote and
`false` when the key already existed.

```ts
if (await cache().add("job:lock", 1, 30)) {
  await runJobOnce(); // we claimed the key
}
```

**Notes:** a best-effort "claim" — a read-then-write, not an atomic compare-and-set
(keel has no lock driver), so treat it as coordination within one isolate, not a
distributed mutex. Accepts the same `{ tags }` option as `put`.

#### `has(key)`

`has(key: string): Promise<boolean>`

`true` when a live (non-expired) value exists at `key`.

```ts
if (await cache().has("otp")) { /* still valid */ }
```

**Notes:** reads through the store, so in the memory store it also triggers the
lazy purge of an expired entry. A stored `undefined` reads as absent.

#### `missing(key)`

`missing(key: string): Promise<boolean>`

The inverse of `has` — `true` when the key is absent or expired.

```ts
if (await cache().missing("profile:1")) await warmProfile(1);
```

#### `forget(key)`

`forget(key: string): Promise<void>`

Removes a single key.

```ts
await cache().forget("user:1"); // next read recomputes
```

**Notes:** a no-op if the key isn't present — never throws on a miss.

#### `forgetMany(keys)`

`forgetMany(keys: string[]): Promise<void>`

Removes several keys at once.

```ts
await cache().forgetMany(["user:1", "user:1:posts", "user:1:stats"]);
```

**Notes:** deletes run concurrently; missing keys are skipped harmlessly.

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

Clears the cache. On the root cache this wipes the whole store; on a
[namespace](#namespacename) it clears only that namespace.

```ts
await cache().flush();                 // everything
await cache().namespace("users").flush(); // just the users namespace
```

**Notes:** the root delegates to the store's `clear()` — wipes every key, not
just the ones you set through this `Cache`. In a shared store that's every
consumer's keys. A namespace flush is a scoped invalidation (version bump), so
entries are logically gone but reclaimed on their TTL.

#### `deleteByTag(tags)`

`deleteByTag(tags: string[]): Promise<void>`

Invalidates every entry tagged with any of `tags` (via `put`/`add`/`remember`'s
`{ tags }` option).

```ts
await cache().put("post:1", post, 600, { tags: ["posts"] });
await cache().deleteByTag(["posts"]); // post:1 (and any other "posts" entry) gone
```

**Notes:** O(number of tags) — bumps a per-tag version counter, so entries on the
old version read as a miss; no key scan. A hard invalidation, so tag-dropped
entries are **not** grace-eligible. Invalidated entries occupy space until their
TTL evicts them.

#### `namespace(name)`

`namespace(name: string): Cache`

Returns a cache scoped under the `name:` key prefix, sharing the same store.

```ts
const users = cache().namespace("users");
await users.put("1", user);   // stored at "users:1"
await users.flush();          // clears only this namespace
```

**Notes:** carries the full `Cache` API (`remember`, `grace`, `tags`, …) and
nests (`namespace("a").namespace("b")` → prefix `a:b:`). Scoped `flush()` uses the
same version-stamp mechanism as tags, so it's O(1) with no key scan.

#### `remember(key, ttlSeconds, factory, options?)`

`remember<T>(key: string, ttlSeconds: number, factory: () => T | Promise<T>, options?: RememberOptions): Promise<T>`

Returns the cached value, or runs `factory`, caches its result for `ttlSeconds`,
and returns it. **Stampede-protected**: concurrent calls for the same cold key
share one factory run.

```ts
const stats = await cache().remember("dashboard.stats", 60, () =>
  computeExpensiveStats(),
);

// With grace: serve the last good value for up to an hour if a refresh throws.
const rates = await cache().remember("fx.rates", 60, fetchRates, { grace: 3600 });

// With tags: invalidate later via deleteByTag(["feeds"]).
const feed = await cache().remember("feed:home", 300, buildFeed, { tags: ["feeds"] });
```

**Notes:** `factory` runs **only on a miss** and may be sync or async (both are
awaited). A stored `undefined` is treated as a miss, so `factory` re-runs. The
`ttlSeconds` argument is required here (unlike `put`); use `rememberForever` for
no expiry. `options.grace` (seconds) retains an expired value that much longer
and returns it if the refreshing `factory` throws — a normal `get` still reports
the expired key as a miss, so stale data never leaks through the plain read path.
`options.tags` joins the cached value to those tags for `deleteByTag`. A failing
factory **without** grace rejects and is not cached.

#### `rememberForever(key, factory, options?)`

`rememberForever<T>(key: string, factory: () => T | Promise<T>, options?: PutOptions): Promise<T>`

Like `remember`, but caches with no TTL. Also stampede-protected, and accepts
`{ tags }`.

```ts
const config = await cache().rememberForever("app.config", () => loadConfig());
```

**Notes:** same miss semantics as `remember` — `factory` runs once, then the
value is served until it's forgotten or flushed. No TTL means grace doesn't
apply (there's nothing to expire).

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
value in `get`, `has`, `pull`, and the `remember` family. `Cache` writes an
opaque envelope (value + expiry + tag stamps) as the store value — treat stored
values as blobs to round-trip, not to read directly.

#### `PutOptions` / `RememberOptions`

```ts
interface PutOptions {
  tags?: string[]; // associate the entry with tags, for deleteByTag
}

interface RememberOptions extends PutOptions {
  grace?: number;  // seconds to retain an expired value for stale-on-error
}
```

`PutOptions` is the trailing options bag on `put`/`add`/`rememberForever`;
`RememberOptions` adds `grace` for `remember`. Both are optional.

```ts
await cache().put("post:1", post, 600, { tags: ["posts"] });
await cache().remember("feed", 300, build, { grace: 60, tags: ["posts"] });
```
