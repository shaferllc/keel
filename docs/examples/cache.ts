// Type-check harness for docs/cache.md. Every snippet in the reference is
// exercised here against the real exports, so a renamed method or wrong argument
// type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  cache,
  Cache,
  MemoryStore,
  singleton,
  type CacheStore,
} from "@shaferllc/keel/core";
import { db } from "@shaferllc/keel/core";

type User = { id: number; name: string };

declare const user: User;
declare const code: string;
declare const cfg: unknown;
declare const config: unknown;
declare const id: number;
declare const name: string;
declare const fallback: string;

declare function computeExpensiveStats(): Promise<{ total: number }>;
declare function loadConfig(): { url: string };

export async function basics() {
  await cache().put("user:1", user);
  await cache().put("otp", code, 300);
  await cache().get("user:1");
  await cache().get("missing", fallback);
  await cache().has("otp");
  await cache().forget("otp");
  await cache().pull("otp");
  await cache().flush();
}

export async function remember() {
  const stats = await cache().remember("dashboard.stats", 60, async () => {
    return computeExpensiveStats();
  });
  const conf = await cache().rememberForever("app.config", () => loadConfig());
  return { stats, conf };
}

export async function readThroughThenInvalidate() {
  const token = await cache().pull<string>("reset:jane", "");

  await db("users").where("id", id).update({ name });
  await cache().forget(`user:${id}`);
  return token;
}

export async function ttls() {
  await cache().put("otp", code, 300);
  await cache().put("app.config", cfg);
}

// --- Custom store (narrative) ---
class RedisStore implements CacheStore {
  async get(key: string) {
    return key;
  }
  async set(key: string, value: unknown, ttlMs?: number) {
    void key;
    void value;
    void ttlMs;
  }
  async delete(key: string) {
    void key;
  }
  async clear() {}
}

export function customStore() {
  singleton(Cache, () => new Cache(new RedisStore()));
}

// --- API reference: cache() / Cache construction ---
export async function cacheHelper() {
  await cache().put("user:1", user);
}

export function construction() {
  const c = new Cache();
  const r = new Cache(new MemoryStore());
  return { c, r };
}

export async function cacheGet() {
  const u = await cache().get<User>("user:1");
  const port = await cache().get("app.port", 3000);
  return { u, port };
}

export async function cachePut() {
  await cache().put("otp", code, 300);
  await cache().put("user:1", user);
}

export async function cacheHas() {
  if (await cache().has("otp")) {
    /* still valid */
  }
}

export async function cacheForget() {
  await cache().forget("user:1");
}

export async function cachePull() {
  const token = await cache().pull<string>("reset:jane", "");
  return token;
}

export async function cacheFlush() {
  await cache().flush();
}

export async function cacheRemember() {
  const stats = await cache().remember("dashboard.stats", 60, () =>
    computeExpensiveStats(),
  );
  return stats;
}

export async function cacheRememberForever() {
  const conf = await cache().rememberForever("app.config", () => loadConfig());
  return conf;
}

// --- MemoryStore methods ---
export function memoryStore() {
  const store = new MemoryStore();
  store.set("k", 1, 1000);
  const v = store.get("k");
  store.set("otp", code, 300_000);
  store.set("cfg", config);
  store.delete("otp");
  store.clear();
  return v;
}

// --- Interfaces & types: CacheStore (KV example) ---
type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
};
declare const kv: KV;

class KVStore implements CacheStore {
  constructor(private kv: KV) {}
  async get(key: string) {
    return (await this.kv.get(key)) ?? undefined;
  }
  async set(key: string, value: unknown, ttlMs?: number) {
    await this.kv.put(key, JSON.stringify(value), ttlMs);
  }
  async delete(key: string) {
    await this.kv.delete(key);
  }
  async clear() {
    /* KV has no bulk clear — list + delete, or skip */
  }
}

export function kvStore() {
  singleton(Cache, () => new Cache(new KVStore(kv)));
}
