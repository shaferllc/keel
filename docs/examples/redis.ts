// Type-check harness for docs/redis.md. Compile-only — never executed.
import {
  redis,
  setRedis,
  Redis,
  MemoryRedis,
  redisStore,
  Cache,
  type RedisConnection,
} from "@shaferllc/keel/core";

declare function computeStats(): Promise<unknown>;
declare function renderHome(): string;
declare function env(key: string): string;

export async function using() {
  setRedis(new MemoryRedis());
  await redis().set("views", "1");
  await redis().incr("views");
  await redis().get("views");
  await redis().set("token", "abc", { ex: 60 });
  await redis().del("token");
}

export async function commands() {
  const r = redis();
  const s = await r.get("k");
  await r.set("k", "v", { ex: 60 });
  const removed = await r.del("a", "b");
  const present = await r.exists("a");
  const has = await r.has("k");
  await r.incr("k");
  await r.decr("k");
  await r.incrBy("k", 5);
  await r.expire("k", 60);
  const ttl = await r.ttl("k");
  const keys = await r.keys("user:*");
  await r.flushAll();
  return { s, removed, present, has, ttl, keys };
}

export async function jsonAndRemember() {
  await redis().setJson("user:1", { id: 1, name: "Ada" });
  const user = await redis().getJson<{ id: number; name: string }>("user:1");
  const stats = await redis().remember("stats", 300, () => computeStats());
  return { user, stats };
}

export async function asCacheStore() {
  const cache = new Cache(redisStore(redis()));
  return cache.remember("home", 60, () => renderHome());
}

export function upstashDriver() {
  const upstash = (url: string, token: string): RedisConnection => {
    const call = (...args: (string | number)[]) =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(args),
      }).then((r) => r.json() as Promise<{ result: unknown }>);
    return {
      async get(key) {
        return ((await call("GET", key)).result as string) ?? null;
      },
      async set(key, value, o) {
        await (o?.ex ? call("SET", key, value, "EX", o.ex) : call("SET", key, value));
      },
      async del(...keys) {
        return (await call("DEL", ...keys)).result as number;
      },
      async exists(...keys) {
        return (await call("EXISTS", ...keys)).result as number;
      },
      async incrBy(key, n) {
        return (await call("INCRBY", key, n)).result as number;
      },
      async expire(key, s) {
        return (await call("EXPIRE", key, s)).result === 1;
      },
      async ttl(key) {
        return (await call("TTL", key)).result as number;
      },
      async keys(pattern) {
        return (await call("KEYS", pattern)).result as string[];
      },
      async flushAll() {
        await call("FLUSHALL");
      },
    };
  };
  setRedis(upstash(env("UPSTASH_URL"), env("UPSTASH_TOKEN")));
}

// Own client instance
export function ownClient() {
  const r = new Redis(new MemoryRedis());
  return r.connection;
}
