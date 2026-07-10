/**
 * A small cache with TTLs and the `remember` pattern. Memory-backed by default
 * (per-process / per-isolate), with a pluggable store so you can swap in Redis,
 * KV, or anything else. Bound as a singleton on the application; reach it with
 * the global `cache()` helper.
 *
 *   const stats = await cache().remember("stats", 60, () => computeStats());
 */

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

export class Cache {
  constructor(private store: CacheStore = new MemoryStore()) {}

  async get<T = unknown>(key: string, fallback?: T): Promise<T> {
    const value = await this.store.get(key);
    return (value === undefined ? (fallback as T) : (value as T));
  }

  /** Store a value, optionally expiring after `ttlSeconds`. */
  async put(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.store.set(key, value, ttlSeconds ? ttlSeconds * 1000 : undefined);
  }

  async has(key: string): Promise<boolean> {
    return (await this.store.get(key)) !== undefined;
  }

  async forget(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** Read and remove a value. */
  async pull<T = unknown>(key: string, fallback?: T): Promise<T> {
    const value = await this.get(key, fallback);
    await this.forget(key);
    return value;
  }

  async flush(): Promise<void> {
    await this.store.clear();
  }

  /**
   * Return the cached value, or compute it with `factory`, cache it for
   * `ttlSeconds`, and return it.
   */
  async remember<T>(key: string, ttlSeconds: number, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get(key);
    if (existing !== undefined) return existing as T;
    const value = await factory();
    await this.put(key, value, ttlSeconds);
    return value;
  }

  /** Like remember(), but cached forever (no TTL). */
  async rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
    const existing = await this.store.get(key);
    if (existing !== undefined) return existing as T;
    const value = await factory();
    await this.put(key, value);
    return value;
  }
}
