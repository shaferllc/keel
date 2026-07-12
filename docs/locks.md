# Locks

"Only one of you may do this at a time" — across processes, across nodes.

```ts
import { lock } from "@shaferllc/keel/core";

const [ran] = await lock("invoice:42").run(async () => {
  await charge(invoice);
});

if (!ran) return; // another worker is already charging it
```

This is the counterpart to the [cache](./cache.md)'s stampede protection. That
collapses concurrent work **inside one isolate**; a lock coordinates work
**between** them. Reach for a lock when doing the thing twice would be *wrong* —
charging a card, sending an invoice, running a migration — not merely wasteful.

Like every other backend in Keel, the store is a small pluggable seam and the core
imports no driver. `MemoryLockStore` is the default; it's per-isolate, so it
coordinates within one process and nothing more — fine for tests and
single-process apps, useless across a cluster. Point it at Redis for the real
thing.

## `run()` — the form you want

```ts
const [ran, result] = await lock("invoice:42").run(() => charge(invoice));
```

It acquires, runs, and **always** releases — the `finally` is what stops a
throwing callback from leaving the lock held until its TTL runs out. It returns
`[ran, result]`; `ran` is `false` if someone else holds the lock, in which case
your callback never ran and `result` is `undefined`.

By default it doesn't wait: if the lock is taken, it gives up immediately. To wait
for it, pass a timeout:

```ts
// Wait up to 5 seconds for the lock, checking every 100ms.
const [ran] = await lock("report").run(() => rebuild(), {
  timeout: 5_000,
  retryDelay: 100,
});
```

`runImmediately()` is the explicit "never wait" spelling.

## TTL and expiry

**A lock always expires.** There's no hold-forever mode, because a holder that
crashes would keep the lock forever and nothing would ever run again. The default
TTL is 30 seconds:

```ts
lock("invoice:42");           // held for 30s once acquired
lock("nightly-report", 300_000); // 5 minutes
```

Pick a TTL comfortably longer than the work. If the work might outrun it, `extend()`
from inside:

```ts
await lock("import", 60_000).run(async () => {
  for (const batch of batches) {
    await process(batch);
    await l.extend(); // push the expiry out another 60s
  }
});
```

`extend()` **throws** `LockNotHeldError` if you've already lost the lock. That's
deliberate: the alternative — silently doing nothing — would let you carry on
believing you hold a lock you don't.

## Ownership, and why it matters

Every acquisition mints a random owner token, and `release()`/`extend()` only
succeed for the owner. This is not bookkeeping — it's the property that makes the
lock correct:

1. Process **A** takes the lock with a 30s TTL.
2. A's work takes longer than 30s. The lock **expires**.
3. Process **B** takes the now-free lock and starts working.
4. A finishes and calls `release()`.

Without ownership, A's release deletes **B's** lock, and a third process walks
straight in while B is still working. With it, A's release is a no-op that returns
`false`. A store must *compare-and-delete*, not just delete.

## Manual acquisition

`acquire()` / `release()` are there when the lock's lifetime doesn't fit a single
callback. You own the `try/finally`:

```ts
const l = lock("invoice:42");
if (!(await l.acquire({ timeout: 2_000 }))) return;

try {
  await charge(invoice);
} finally {
  await l.release(); // without this, the lock leaks for the rest of its TTL
}
```

Prefer `run()`. It exists so you can't forget the `finally`.

## Handing a lock to another process

`serialize()` freezes the key, TTL, and **owner token** to a string.
`restoreLock()` rebuilds it elsewhere — so one process can take the lock and
another can release or extend the *same* lock:

```ts
// worker A
const l = lock("import:99", 60_000);
await l.acquire();
await queue.dispatch(new FinishImport(l.serialize()));

// worker B, later
const l = restoreLock(serialized);
await l.extend(60_000);
// ...finish the work...
await l.release();
```

## Inspecting a lock

```ts
await l.isLocked(); // does anyone hold this key? (not necessarily you)
await l.isExpired(); // did we hold it and lose it?
await l.getRemainingTime(); // ms until expiry, or null if unheld
```

## Testing

The default `MemoryLockStore` needs no setup. Give each test a clean one so keys
can't leak between them:

```ts
import { setLockStore, MemoryLockStore } from "@shaferllc/keel/core";

beforeEach(() => setLockStore(new MemoryLockStore()));
```

## Writing a store

A store is the `LockStore` interface. Implementations **must** make `acquire`
atomic (set-if-absent) and make `release`/`extend` conditional on the owner
matching — a store that can't do both isn't a lock, it's a suggestion.

### Redis

Redis gives you both: `SET key owner PX ttl NX` is an atomic set-if-absent, and a
small Lua script makes release and extend compare-and-act. This example uses
[ioredis](https://github.com/redis/ioredis); any client with `set` and `eval` works
the same way.

```ts
import type { LockStore } from "@shaferllc/keel/core";
import type { Redis } from "ioredis";

// Compare-and-delete: only delete if the value still matches our owner token.
const RELEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

// Compare-and-extend, same idea.
const EXTEND = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  end
  return 0
`;

export const redisLockStore = (client: Redis): LockStore => ({
  async acquire(key, owner, ttlMs) {
    // NX = only if absent. This is the atomic bit.
    const res = await client.set(key, owner, "PX", ttlMs, "NX");
    return res === "OK";
  },
  async release(key, owner) {
    return (await client.eval(RELEASE, 1, key, owner)) === 1;
  },
  async extend(key, owner, ttlMs) {
    return (await client.eval(EXTEND, 1, key, owner, String(ttlMs))) === 1;
  },
  async isLocked(key) {
    return (await client.exists(key)) === 1;
  },
  async remainingTime(key) {
    const ms = await client.pttl(key);
    return ms < 0 ? null : ms; // -1 = no expiry, -2 = no key
  },
});
```

```ts
setLockStore(redisLockStore(client));
```

### Database

A unique primary key on `key` gives you the atomicity — the insert fails if
someone already holds it. Expired rows are treated as free.

```sql
CREATE TABLE locks (
  key        TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
```

```ts
import { connection } from "@shaferllc/keel/core";

export const databaseLockStore = (table = "locks"): LockStore => ({
  async acquire(key, owner, ttlMs) {
    const now = Date.now();
    // Clear the row first if it has expired, then insert. The PK makes the
    // insert the atomic step: two racing writers, one unique-violation.
    await connection().write(`DELETE FROM ${table} WHERE key = ? AND expires_at <= ?`, [key, now]);
    try {
      await connection().write(
        `INSERT INTO ${table} (key, owner, expires_at) VALUES (?, ?, ?)`,
        [key, owner, now + ttlMs],
      );
      return true;
    } catch {
      return false; // someone else holds it
    }
  },
  async release(key, owner) {
    const res = await connection().write(`DELETE FROM ${table} WHERE key = ? AND owner = ?`, [key, owner]);
    return res.changes > 0;
  },
  async extend(key, owner, ttlMs) {
    const res = await connection().write(
      `UPDATE ${table} SET expires_at = ? WHERE key = ? AND owner = ? AND expires_at > ?`,
      [Date.now() + ttlMs, key, owner, Date.now()],
    );
    return res.changes > 0;
  },
  async isLocked(key) {
    const rows = await connection().select(
      `SELECT 1 FROM ${table} WHERE key = ? AND expires_at > ?`,
      [key, Date.now()],
    );
    return rows.length > 0;
  },
  async remainingTime(key) {
    const rows = await connection().select(`SELECT expires_at FROM ${table} WHERE key = ?`, [key]);
    const row = rows[0] as { expires_at: number } | undefined;
    if (!row) return null;
    const left = Number(row.expires_at) - Date.now();
    return left > 0 ? left : null;
  },
});
```

Redis is the better fit if you have it — the database store pays a round trip per
operation and needs the expired rows cleaned up.

---

## API reference

### `lock(key, ttlMs?)`

`lock(key: string, ttlMs?: number): Lock`

A lock on `key`, held for `ttlMs` once acquired (default `30_000`).

### `Lock`

| Method | Signature |
|--------|-----------|
| `run` | `<T>(fn, options?: AcquireOptions) => Promise<[boolean, T \| undefined]>` — acquire, run, always release |
| `runImmediately` | `<T>(fn) => Promise<[boolean, T \| undefined]>` — never waits |
| `acquire` | `(options?: AcquireOptions) => Promise<boolean>` |
| `acquireImmediately` | `() => Promise<boolean>` |
| `release` | `() => Promise<boolean>` — false if we no longer hold it |
| `extend` | `(ttlMs?) => Promise<void>` — throws `LockNotHeldError` if lost |
| `isLocked` | `() => Promise<boolean>` — does *anyone* hold it |
| `isExpired` | `() => Promise<boolean>` — did *we* hold it and lose it |
| `getRemainingTime` | `() => Promise<number \| null>` — ms until expiry |
| `serialize` | `() => string` — key + TTL + owner token |

### `restoreLock(serialized)`

`restoreLock(serialized: string): Lock` — rebuild a lock from `serialize()`, owner
token and all, so another process can release or extend it.

### `setLockStore(store)` / `getLockStore()`

Register the store `lock()` uses, and read it back.

### Interfaces & types

#### `LockStore`

`acquire(key, owner, ttlMs)` / `release(key, owner)` / `extend(key, owner, ttlMs)` /
`isLocked(key)` / `remainingTime(key)`. `acquire` must be atomic; `release` and
`extend` must be conditional on the owner.

#### `AcquireOptions`

`{ timeout?: number, retryDelay?: number }` — how long to wait for a held lock
(default `0`, don't wait) and how often to retry (default `50`ms).

#### `MemoryLockStore`

The default. Per-isolate — for tests and single-process apps.

#### `LockNotHeldError`

Thrown by `extend()` when the lock has expired or was never acquired.
