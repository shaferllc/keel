// Type-check harness for docs/locks.md. Compile-only — never executed.
import {
  lock,
  restoreLock,
  setLockStore,
  getLockStore,
  Lock,
  MemoryLockStore,
  LockNotHeldError,
  type LockStore,
  type AcquireOptions,
} from "@shaferllc/keel/core";

declare const invoice: { id: number };
declare function charge(invoice: { id: number }): Promise<void>;
declare function rebuild(): Promise<void>;
declare function process(batch: unknown): Promise<void>;
declare const batches: unknown[];

export async function running() {
  const [ran, result] = await lock("invoice:42").run(() => charge(invoice));
  if (!ran) return undefined;
  return result;
}

export async function waiting() {
  const options: AcquireOptions = { timeout: 5_000, retryDelay: 100 };
  const [ran] = await lock("report").run(() => rebuild(), options);

  const [immediate] = await lock("report").runImmediately(() => rebuild());
  return { ran, immediate };
}

export async function ttlAndExtend() {
  const l = lock("import", 60_000);
  await l.run(async () => {
    for (const batch of batches) {
      await process(batch);
      await l.extend();
    }
  });
}

export async function manualAcquisition() {
  const l = lock("invoice:42");
  if (!(await l.acquire({ timeout: 2_000 }))) return;

  try {
    await charge(invoice);
  } finally {
    await l.release();
  }
}

export async function handoff(): Promise<string> {
  const l = lock("import:99", 60_000);
  await l.acquire();
  return l.serialize();
}

export async function resume(serialized: string) {
  const l = restoreLock(serialized);
  await l.extend(60_000);
  await l.release();
}

export async function inspecting() {
  const l = lock("k");
  return {
    locked: await l.isLocked(),
    expired: await l.isExpired(),
    remaining: await l.getRemainingTime(),
  };
}

export function testing() {
  setLockStore(new MemoryLockStore());
  return getLockStore();
}

export function errors(err: unknown) {
  return err instanceof LockNotHeldError;
}

// A custom store (the shape of the Redis / database recipes).
export function customStore(): LockStore {
  const entries = new Map<string, { owner: string; expiresAt: number }>();
  return {
    async acquire(key, owner, ttlMs) {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > Date.now()) return false;
      entries.set(key, { owner, expiresAt: Date.now() + ttlMs });
      return true;
    },
    async release(key, owner) {
      const entry = entries.get(key);
      if (!entry || entry.owner !== owner) return false;
      entries.delete(key);
      return true;
    },
    async extend(key, owner, ttlMs) {
      const entry = entries.get(key);
      if (!entry || entry.owner !== owner) return false;
      entry.expiresAt = Date.now() + ttlMs;
      return true;
    },
    async isLocked(key) {
      const entry = entries.get(key);
      return !!entry && entry.expiresAt > Date.now();
    },
    async remainingTime(key) {
      const entry = entries.get(key);
      return entry ? entry.expiresAt - Date.now() : null;
    },
  };
}

export function direct(): Lock {
  return new Lock("k", 1_000, new MemoryLockStore());
}
