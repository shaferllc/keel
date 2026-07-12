/**
 * Distributed locks — "only one of you may do this at a time", across processes
 * and across nodes. The counterpart to the cache's stampede protection: that
 * collapses concurrent work *inside one isolate*, this one coordinates work
 * *between* them.
 *
 *   const [ran] = await lock("invoice:42").run(async () => charge(invoice));
 *   if (!ran) return;   // someone else is already charging it
 *
 * Like every other backend in keel, the store is a small pluggable seam and the
 * core imports no driver — `MemoryLockStore` is the built-in default (per
 * isolate, so it's for tests and single-process apps); the locks guide has Redis
 * and database recipes for the real thing.
 *
 * ## Two safety properties, both easy to get wrong
 *
 * **Ownership.** Every acquisition mints a random owner token, and release and
 * extend only succeed for the owner. Without that, a lock whose TTL expired
 * mid-work gets picked up by process B, and process A's `release()` — arriving
 * late — would delete *B's* lock, letting a third process in. A store must
 * compare-and-delete, not just delete.
 *
 * **TTL.** A lock always expires. If a holder crashes, the lock must not be held
 * forever, so there's no "hold until released" mode. Pick a TTL longer than the
 * work; if the work might outrun it, `extend()` from inside.
 */

/* --------------------------------- store ---------------------------------- */

/**
 * The bridge to a lock backend.
 *
 * Every method is keyed by `owner` for the reason above: implementations MUST
 * make `acquire` atomic (set-if-absent) and `release`/`extend` conditional on
 * the owner matching. A store that can't do that isn't a lock.
 */
export interface LockStore {
  /** Set the key if absent. Returns whether this owner got it. Must be atomic. */
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Delete the key only if `owner` still holds it. Returns whether it did. */
  release(key: string, owner: string): Promise<boolean>;
  /** Push the expiry out, only if `owner` still holds it. */
  extend(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Whether anyone currently holds the key. */
  isLocked(key: string): Promise<boolean>;
  /** Milliseconds until the key expires, or null if nobody holds it. */
  remainingTime(key: string): Promise<number | null>;
}

interface Entry {
  owner: string;
  expiresAt: number;
}

/**
 * An in-memory `LockStore` — the default. Per-isolate, so it coordinates
 * *within* one process and nothing more: perfect for tests and single-process
 * apps, useless across a cluster. Point `setLockStore()` at Redis for that.
 */
export class MemoryLockStore implements LockStore {
  private entries = new Map<string, Entry>();

  /** The live entry for a key, dropping it if it has expired. */
  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.entries.set(key, { owner, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const entry = this.live(key);
    if (!entry || entry.owner !== owner) return false;
    this.entries.delete(key);
    return true;
  }

  async extend(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const entry = this.live(key);
    if (!entry || entry.owner !== owner) return false;
    entry.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async isLocked(key: string): Promise<boolean> {
    return this.live(key) !== undefined;
  }

  async remainingTime(key: string): Promise<number | null> {
    const entry = this.live(key);
    return entry ? entry.expiresAt - Date.now() : null;
  }
}

/* --------------------------------- options -------------------------------- */

export interface AcquireOptions {
  /**
   * Give up after this many milliseconds of waiting. Default: 0 — don't wait at
   * all, fail immediately if the lock is held.
   */
  timeout?: number;
  /** Milliseconds between attempts while waiting. Default: 50. */
  retryDelay?: number;
}

/** A lock that has expired or was never held. */
export class LockNotHeldError extends Error {
  constructor(key: string) {
    super(`The lock "${key}" is not held by you — it expired or was released.`);
    this.name = "LockNotHeldError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A random owner token. Web Crypto, so it works on Node and the edge. */
function mintOwner(): string {
  return crypto.randomUUID();
}

/* ---------------------------------- lock ---------------------------------- */

export class Lock {
  /** Non-null only while this instance holds the lock. */
  private owner?: string;

  constructor(
    readonly key: string,
    /** How long the lock is held before it expires on its own. Milliseconds. */
    readonly ttlMs: number,
    private store: LockStore,
    owner?: string,
  ) {
    this.owner = owner;
  }

  /**
   * Take the lock, run `fn`, and always give it back — the form you want almost
   * every time, because the `finally` is what stops a throwing callback from
   * leaving the lock held until its TTL runs out.
   *
   * Returns `[ran, result]`: `ran` is false if someone else holds it, in which
   * case `fn` never ran.
   *
   *   const [ran, invoice] = await lock("invoice:42").run(() => charge(id));
   *   if (!ran) return;   // another worker is on it
   */
  async run<T>(fn: () => Promise<T> | T, options: AcquireOptions = {}): Promise<[boolean, T | undefined]> {
    if (!(await this.acquire(options))) return [false, undefined];
    try {
      return [true, await fn()];
    } finally {
      await this.release();
    }
  }

  /** `run()`, but never waits: if the lock is held, give up at once. */
  runImmediately<T>(fn: () => Promise<T> | T): Promise<[boolean, T | undefined]> {
    return this.run(fn, { timeout: 0 });
  }

  /**
   * Take the lock, waiting up to `timeout` for it. Returns whether we got it.
   *
   * Prefer `run()` — with a bare `acquire()` you own the `try/finally`, and a
   * throw between here and `release()` leaks the lock for the rest of its TTL.
   */
  async acquire(options: AcquireOptions = {}): Promise<boolean> {
    const { timeout = 0, retryDelay = 50 } = options;
    const deadline = Date.now() + timeout;
    const owner = mintOwner();

    for (;;) {
      if (await this.store.acquire(this.key, owner, this.ttlMs)) {
        this.owner = owner;
        return true;
      }
      // Wait only if there's time left to wait *and* to sleep before the deadline.
      if (Date.now() + retryDelay >= deadline) return false;
      await sleep(retryDelay);
    }
  }

  /** Take the lock only if it's free right now. */
  acquireImmediately(): Promise<boolean> {
    return this.acquire({ timeout: 0 });
  }

  /** Give the lock back. A no-op if we no longer hold it (it may have expired). */
  async release(): Promise<boolean> {
    if (!this.owner) return false;
    const released = await this.store.release(this.key, this.owner);
    this.owner = undefined;
    return released;
  }

  /**
   * Push the expiry out — for work that might outrun the TTL. Throws
   * `LockNotHeldError` if we've already lost it, because the alternative (a
   * silent no-op) would let you carry on believing you hold a lock you don't.
   */
  async extend(ttlMs: number = this.ttlMs): Promise<void> {
    if (!this.owner || !(await this.store.extend(this.key, this.owner, ttlMs))) {
      this.owner = undefined;
      throw new LockNotHeldError(this.key);
    }
  }

  /** Whether *anyone* holds this key — not necessarily us. */
  isLocked(): Promise<boolean> {
    return this.store.isLocked(this.key);
  }

  /** Whether we held this lock but no longer do. */
  async isExpired(): Promise<boolean> {
    if (!this.owner) return false; // never acquired — not the same as expired
    return !(await this.store.isLocked(this.key));
  }

  /** Milliseconds until the lock expires, or null if nobody holds it. */
  getRemainingTime(): Promise<number | null> {
    return this.store.remainingTime(this.key);
  }

  /**
   * Freeze the lock (key, TTL, owner token) to a string, so another process can
   * `restoreLock()` it and release or extend the *same* lock — the handoff you
   * need when one process takes the lock and another finishes the work.
   */
  serialize(): string {
    return JSON.stringify({ key: this.key, ttlMs: this.ttlMs, owner: this.owner });
  }
}

/* --------------------------------- global --------------------------------- */

let store: LockStore = new MemoryLockStore();

/** Register the lock store used by `lock()`. */
export function setLockStore(next: LockStore): LockStore {
  store = next;
  return store;
}

/** The active lock store. */
export function getLockStore(): LockStore {
  return store;
}

/**
 * A lock on `key`, held for `ttlMs` once acquired (default 30s).
 *
 *   const [ran] = await lock("invoice:42").run(() => charge(invoice));
 */
export function lock(key: string, ttlMs = 30_000): Lock {
  return new Lock(key, ttlMs, store);
}

/** Rebuild a lock from `serialize()` — same key, same TTL, same owner token. */
export function restoreLock(serialized: string): Lock {
  const { key, ttlMs, owner } = JSON.parse(serialized) as {
    key: string;
    ttlMs: number;
    owner?: string;
  };
  return new Lock(key, ttlMs, store, owner);
}
