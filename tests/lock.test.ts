import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lock,
  restoreLock,
  setLockStore,
  getLockStore,
  Lock,
  MemoryLockStore,
  LockNotHeldError,
  type LockStore,
} from "../src/core/lock.js";

/** Each test gets a clean store, so keys can't leak between them. */
function freshStore(): MemoryLockStore {
  const store = new MemoryLockStore();
  setLockStore(store);
  return store;
}

/* ------------------------------- acquiring -------------------------------- */

test("acquire takes a free lock and release gives it back", async () => {
  freshStore();
  const l = lock("invoice:42");

  assert.equal(await l.acquire(), true);
  assert.equal(await l.isLocked(), true);

  assert.equal(await l.release(), true);
  assert.equal(await l.isLocked(), false);
});

test("a second holder cannot take a held lock", async () => {
  freshStore();
  const first = lock("invoice:42");
  const second = lock("invoice:42");

  assert.equal(await first.acquire(), true);
  assert.equal(await second.acquireImmediately(), false);

  await first.release();
  assert.equal(await second.acquireImmediately(), true);
});

test("acquire waits up to timeout, and gets the lock when it frees up", async () => {
  freshStore();
  const holder = lock("k", 10_000);
  await holder.acquire();

  // Release shortly; a waiter with a generous timeout should pick it up.
  setTimeout(() => void holder.release(), 60);

  const waiter = lock("k");
  const started = Date.now();
  assert.equal(await waiter.acquire({ timeout: 1000, retryDelay: 20 }), true);
  assert.ok(Date.now() - started >= 50, "should have waited for the holder");
});

test("acquire gives up when the timeout elapses", async () => {
  freshStore();
  await lock("k", 10_000).acquire();

  const started = Date.now();
  assert.equal(await lock("k").acquire({ timeout: 120, retryDelay: 20 }), false);
  assert.ok(Date.now() - started >= 80, "should have waited out the timeout");
});

test("acquire with no timeout does not wait at all", async () => {
  freshStore();
  await lock("k", 10_000).acquire();

  const started = Date.now();
  assert.equal(await lock("k").acquire(), false);
  assert.ok(Date.now() - started < 40, "should have failed immediately");
});

/* ---------------------------------- run ----------------------------------- */

test("run acquires, runs, and always releases", async () => {
  freshStore();
  const l = lock("k");

  const [ran, result] = await l.run(() => "charged");
  assert.equal(ran, true);
  assert.equal(result, "charged");
  assert.equal(await l.isLocked(), false); // released
});

test("run releases even when the callback throws", async () => {
  freshStore();
  const l = lock("k");

  await assert.rejects(
    () =>
      l.run(() => {
        throw new Error("boom");
      }),
    /boom/,
  );
  // The whole point of the finally: a throwing callback must not leave the lock held.
  assert.equal(await l.isLocked(), false);
});

test("run reports ran=false and skips the callback when the lock is held", async () => {
  freshStore();
  await lock("k", 10_000).acquire();

  let called = false;
  const [ran, result] = await lock("k").run(() => {
    called = true;
    return "nope";
  });

  assert.equal(ran, false);
  assert.equal(result, undefined);
  assert.equal(called, false);
});

test("runImmediately does not wait", async () => {
  freshStore();
  await lock("k", 10_000).acquire();

  const started = Date.now();
  const [ran] = await lock("k").runImmediately(() => "x");
  assert.equal(ran, false);
  assert.ok(Date.now() - started < 40);
});

test("only one of many concurrent runners gets through", async () => {
  freshStore();
  let runs = 0;

  const results = await Promise.all(
    Array.from({ length: 8 }, () => lock("invoice:42").runImmediately(() => ++runs)),
  );

  assert.equal(runs, 1);
  assert.equal(results.filter(([ran]) => ran).length, 1);
});

/* -------------------------------- ownership ------------------------------- */

test("release only works for the owner — a late release cannot free someone else's lock", async () => {
  const store = freshStore();

  // A holds the lock, then it expires.
  const a = lock("k", 30);
  await a.acquire();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await a.isLocked(), false); // expired

  // B takes it.
  const b = lock("k", 10_000);
  assert.equal(await b.acquire(), true);

  // A's release arrives late. It must NOT free B's lock.
  assert.equal(await a.release(), false);
  assert.equal(await store.isLocked("k"), true, "B must still hold the lock");
});

test("extend pushes the expiry out for the owner", async () => {
  freshStore();
  const l = lock("k", 60);
  await l.acquire();

  await l.extend(5_000);
  const remaining = await l.getRemainingTime();
  assert.ok(remaining !== null && remaining > 1_000, `expected a long TTL, got ${remaining}`);
});

test("extend throws once the lock is lost, rather than silently doing nothing", async () => {
  freshStore();
  const l = lock("k", 30);
  await l.acquire();
  await new Promise((r) => setTimeout(r, 50)); // let it expire

  await assert.rejects(() => l.extend(1_000), LockNotHeldError);
});

test("extend throws when the lock was never acquired", async () => {
  freshStore();
  await assert.rejects(() => lock("k").extend(1_000), LockNotHeldError);
});

/* --------------------------------- state ---------------------------------- */

test("a lock expires on its own", async () => {
  freshStore();
  const l = lock("k", 30);
  await l.acquire();
  assert.equal(await l.isLocked(), true);

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await l.isLocked(), false);
  assert.equal(await l.isExpired(), true);

  // ...and is free for the taking.
  assert.equal(await lock("k").acquireImmediately(), true);
});

test("getRemainingTime reports the TTL, or null when unheld", async () => {
  freshStore();
  assert.equal(await lock("k").getRemainingTime(), null);

  const l = lock("k", 5_000);
  await l.acquire();
  const remaining = await l.getRemainingTime();
  assert.ok(remaining !== null && remaining > 4_000 && remaining <= 5_000);
});

test("isExpired is false for a lock never acquired", async () => {
  freshStore();
  assert.equal(await lock("k").isExpired(), false);
});

/* ------------------------------- serializing ------------------------------ */

test("serialize/restoreLock hands the same lock to another process", async () => {
  const store = freshStore();

  const original = lock("invoice:42", 10_000);
  await original.acquire();

  // Another process rebuilds it from the string and releases the SAME lock.
  const restored = restoreLock(original.serialize());
  assert.equal(restored.key, "invoice:42");
  assert.equal(await restored.release(), true);
  assert.equal(await store.isLocked("invoice:42"), false);
});

test("a restored lock can extend the original", async () => {
  freshStore();
  const original = lock("k", 60);
  await original.acquire();

  const restored = restoreLock(original.serialize());
  await restored.extend(5_000); // would throw if the owner token didn't carry over

  const remaining = await restored.getRemainingTime();
  assert.ok(remaining !== null && remaining > 1_000);
});

/* --------------------------------- store ---------------------------------- */

test("setLockStore swaps the backend and lock() uses it", async () => {
  const calls: string[] = [];
  const custom: LockStore = {
    async acquire(key) {
      calls.push(`acquire ${key}`);
      return true;
    },
    async release(key) {
      calls.push(`release ${key}`);
      return true;
    },
    async extend() {
      return true;
    },
    async isLocked() {
      return false;
    },
    async remainingTime() {
      return null;
    },
  };

  setLockStore(custom);
  assert.equal(getLockStore(), custom);

  await lock("k").run(() => "x");
  assert.deepEqual(calls, ["acquire k", "release k"]);

  setLockStore(new MemoryLockStore()); // don't leak into other tests
});

test("a Lock can be constructed against a store directly", async () => {
  const store = new MemoryLockStore();
  const l = new Lock("k", 1_000, store);

  assert.equal(await l.acquire(), true);
  assert.equal(await store.isLocked("k"), true);
});
