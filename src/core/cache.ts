/**
 * A small cache with TTLs and the `remember` pattern. Memory-backed by default
 * (per-process / per-isolate), with a pluggable store so you can swap in Redis,
 * KV, or anything else. Bound as a singleton on the application; reach it with
 * the global `cache()` helper.
 *
 *   const stats = await cache().remember("stats", 60, () => computeStats());
 *
 * The resilience features, kept inside keel's single-store, edge-safe model:
 *
 *   - Stampede protection — concurrent `remember()` calls for the same cold key
 *     run the factory ONCE and share the result, instead of dog-piling.
 *   - Grace / stale-on-error — with a `grace` window, an expired value is kept
 *     a little longer and served if the refreshing factory throws.
 *   - Tags — group entries and invalidate them together with `deleteByTag()`.
 *   - Namespaces — `namespace("users")` scopes keys under a prefix, and its
 *     `flush()` clears only that namespace.
 *
 * Tag and namespace invalidation use version stamps, not a key index: each tag
 * carries a counter, every entry records the counter values it was written at,
 * and invalidation just bumps the counter — so an entry whose tag has moved on
 * reads as a miss. O(1) invalidation, no key-set bookkeeping, works on any
 * `CacheStore`.
 */

import { instrument, currentRequestId } from "./instrumentation.js";

export interface CacheStore {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown, ttlMs?: number): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** The default in-memory store. */
export class MemoryStore implements CacheStore {
  private data = new Map<string, { value: unknown; expires: number }>();

  get(key: string): unknown {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }
  set(key: string, value: unknown, ttlMs?: number): void {
    this.data.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 });
  }
  delete(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

/**
 * A cache entry envelope. The value (`v`) is wrapped with its logical expiry
 * (`e`, epoch ms; 0 = never) and the tag versions it was written under (`t`), so
 * the cache can tell a fresh value from an expired-but-graced or tag-invalidated
 * one. Stores hold these opaque blobs — don't read them directly; go through the
 * `Cache` API.
 */
interface Entry {
  __keelCache: 1;
  v: unknown;
  e: number;
  t?: Record<string, number>;
}

function isEntry(x: unknown): x is Entry {
  return typeof x === "object" && x !== null && (x as Entry).__keelCache === 1;
}

/** Options for `put`/`add`. */
export interface PutOptions {
  /** Tags to associate with this entry, for `deleteByTag` invalidation. */
  tags?: string[];
}

/** Options for the `remember` family. */
export interface RememberOptions extends PutOptions {
  /**
   * Grace window in seconds. After the value's TTL lapses, keep it this much
   * longer and serve it if the refreshing factory throws (stale-on-error).
   */
  grace?: number;
}

// The store key that holds a tag's version counter. Never namespaced, never
// expired — a bump must outlive every entry that recorded the old version.
const TAG_VERSION_PREFIX = "\u0000keel:tagv:";

export class Cache {
  constructor(private store: CacheStore = new MemoryStore()) {}

  // Key prefix + implicit tag for a namespaced cache (empty on the root).
  private prefix = "";
  private nsTag?: string;

  // Stampede protection: in-flight factory promises, keyed by prefixed key.
  private inflight = new Map<string, Promise<unknown>>();

  /** Apply this cache's namespace prefix to a logical key. */
  private k(key: string): string {
    return this.prefix + key;
  }

  private tagKey(tag: string): string {
    return TAG_VERSION_PREFIX + tag;
  }

  private async tagVersion(tag: string): Promise<number> {
    const v = await this.store.get(this.tagKey(tag));
    return typeof v === "number" ? v : 0;
  }

  /** Snapshot the current version of each tag, to stamp onto a new entry. */
  private async stampTags(tags: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const tag of tags) out[tag] = await this.tagVersion(tag);
    return out;
  }

  /** True if any recorded tag version is behind the live one (invalidated). */
  private async tagsInvalidated(recorded: Record<string, number>): Promise<boolean> {
    for (const [tag, ver] of Object.entries(recorded)) {
      if ((await this.tagVersion(tag)) > ver) return true;
    }
    return false;
  }

  /**
   * Read the raw envelope for a key. Returns undefined when absent OR when a tag
   * has invalidated it — tag/namespace invalidation is a hard miss (not grace-
   * eligible). TTL freshness is left to callers, so grace can still see a stale
   * entry.
   */
  private async entry(key: string): Promise<Entry | undefined> {
    const raw = await this.store.get(this.k(key));
    if (raw === undefined) return undefined;
    const e: Entry = isEntry(raw) ? raw : { __keelCache: 1, v: raw, e: 0 };
    if (e.t && (await this.tagsInvalidated(e.t))) return undefined;
    return e;
  }

  private async write(
    key: string,
    value: unknown,
    ttlSeconds?: number,
    graceSeconds = 0,
    tags: string[] = [],
  ): Promise<void> {
    const allTags = this.nsTag ? [this.nsTag, ...tags] : tags;
    const now = Date.now();
    const e = ttlSeconds ? now + ttlSeconds * 1000 : 0;
    const storeTtlMs = ttlSeconds ? (ttlSeconds + graceSeconds) * 1000 : undefined;
    const t = allTags.length ? await this.stampTags(allTags) : undefined;
    const entry: Entry = { __keelCache: 1, v: value, e };
    if (t) entry.t = t;
    await this.store.set(this.k(key), entry, storeTtlMs);
  }

  async get<T = unknown>(key: string, fallback?: T): Promise<T> {
    const entry = await this.entry(key);
    const hit = !!entry && !(entry.e && entry.e < Date.now());
    const requestId = currentRequestId();
    instrument(hit ? "cache.hit" : "cache.miss", {
      key,
      store: this.store.constructor.name,
      ...(requestId ? { requestId } : {}),
    });
    if (!entry) return fallback as T;
    if (entry.e && entry.e < Date.now()) return fallback as T; // expired (grace-retained)
    return entry.v as T;
  }

  /** Store a value, optionally expiring after `ttlSeconds`, with optional tags. */
  async put(key: string, value: unknown, ttlSeconds?: number, options?: PutOptions): Promise<void> {
    await this.write(key, value, ttlSeconds, 0, options?.tags ?? []);
  }

  /** Store a value only if the key is absent. Returns whether it was written. */
  async add(key: string, value: unknown, ttlSeconds?: number, options?: PutOptions): Promise<boolean> {
    if (await this.has(key)) return false;
    await this.put(key, value, ttlSeconds, options);
    return true;
  }

  async has(key: string): Promise<boolean> {
    const entry = await this.entry(key);
    if (!entry) return false;
    return !(entry.e && entry.e < Date.now());
  }

  /** The inverse of `has` — true when the key is absent or expired. */
  async missing(key: string): Promise<boolean> {
    return !(await this.has(key));
  }

  async forget(key: string): Promise<void> {
    await this.store.delete(this.k(key));
  }

  /** Forget several keys at once. */
  async forgetMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.store.delete(this.k(k))));
  }

  /** Read and remove a value. */
  async pull<T = unknown>(key: string, fallback?: T): Promise<T> {
    const value = await this.get(key, fallback);
    await this.forget(key);
    return value;
  }

  async flush(): Promise<void> {
    // A namespace clears itself by moving its tag version on; the root wipes the
    // whole store.
    if (this.nsTag) await this.deleteByTag([this.nsTag]);
    else await this.store.clear();
  }

  /**
   * Invalidate every entry carrying any of these tags by bumping the tag's
   * version — entries stamped with the old version then read as a miss. O(#tags),
   * no key scan; invalidated entries fall out on their own TTL.
   */
  async deleteByTag(tags: string[]): Promise<void> {
    for (const tag of tags) {
      const current = await this.tagVersion(tag);
      await this.store.set(this.tagKey(tag), current + 1); // no TTL — must persist
    }
  }

  /**
   * A cache scoped under a key prefix. Keys written through it live at
   * `name:key`, and its `flush()` clears only this namespace (via an implicit
   * tag) — the rest of the store is untouched. Namespaces nest.
   *
   *   const users = cache().namespace("users");
   *   await users.put("1", user);   // stored at "users:1"
   *   await users.flush();          // clears only the users namespace
   */
  namespace(name: string): Cache {
    const child = new Cache(this.store);
    child.prefix = `${this.prefix}${name}:`;
    child.nsTag = `\u0000keel:ns:${this.prefix}${name}`;
    return child;
  }

  /**
   * Return the cached value, or compute it with `factory`, cache it for
   * `ttlSeconds`, and return it.
   *
   * Concurrent calls for the same cold key share one factory run (stampede
   * protection). With `{ grace }`, an expired value is retained that many extra
   * seconds and served if the refreshing factory throws (stale-on-error). With
   * `{ tags }`, the cached value joins those tags for `deleteByTag`.
   */
  remember<T>(
    key: string,
    ttlSeconds: number,
    factory: () => T | Promise<T>,
    options?: RememberOptions,
  ): Promise<T> {
    return this.resolve(key, ttlSeconds, factory, options?.grace ?? 0, options?.tags ?? []);
  }

  /** Like remember(), but cached forever (no TTL). Also stampede-protected. */
  rememberForever<T>(
    key: string,
    factory: () => T | Promise<T>,
    options?: PutOptions,
  ): Promise<T> {
    return this.resolve(key, undefined, factory, 0, options?.tags ?? []);
  }

  private async resolve<T>(
    key: string,
    ttlSeconds: number | undefined,
    factory: () => T | Promise<T>,
    graceSeconds: number,
    tags: string[],
  ): Promise<T> {
    const entry = await this.entry(key);
    const fresh = entry && (!entry.e || entry.e > Date.now());
    if (fresh) return entry!.v as T;

    // Stampede protection: join an in-flight computation for this key.
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const run = (async () => {
      try {
        // Defer to a microtask so a synchronously-throwing factory rejects the
        // shared promise only after every joiner has attached its handler.
        const value = await Promise.resolve().then(factory);
        await this.write(key, value, ttlSeconds, graceSeconds, tags);
        return value;
      } catch (err) {
        // Grace: a stale-but-retained value rescues a failing refresh.
        if (entry && graceSeconds > 0) return entry.v as T;
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, run);
    return run;
  }
}
