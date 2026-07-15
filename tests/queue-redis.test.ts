import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Redis, MemoryRedis, setRedis, type RedisConnection } from "../src/core/redis.js";
import {
  Job,
  Queue,
  RedisDriver,
  registerJobs,
  noBackoff,
  fixedBackoff,
} from "../src/core/queue.js";

const ran: string[] = [];

class Greet extends Job {
  constructor(public name = "") {
    super();
  }
  async handle(): Promise<void> {
    ran.push(`hello ${this.name}`);
  }
}

class Flaky extends Job {
  static override maxRetries = 1;
  static override backoff = noBackoff;
  static succeedOnAttempt = Infinity;

  async handle(): Promise<void> {
    if ((this.context?.attempt ?? 1) < Flaky.succeedOnAttempt) throw new Error("flaked");
    ran.push("flaky ok");
  }
}

class Slow extends Job {
  static override backoff = fixedBackoff(60_000);
  static override maxRetries = 3;
  async handle(): Promise<void> {
    throw new Error("always slow");
  }
}

function fresh(): { driver: RedisDriver; client: Redis } {
  const client = new Redis(new MemoryRedis());
  return { driver: new RedisDriver({ client }), client };
}

beforeEach(() => {
  ran.length = 0;
  registerJobs(Greet, Flaky, Slow);
});

test("redis driver: dispatch persists a member, work() runs and removes it", async () => {
  const { driver } = fresh();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("Ada"));
  assert.equal(await driver.pending(), 1);
  assert.deepEqual(ran, []); // persisted, not executed

  assert.equal(await queue.work(), 1);
  assert.deepEqual(ran, ["hello Ada"]);
  assert.equal(await driver.pending(), 0);
});

test("redis driver: a closure is refused with a pointed error", async () => {
  const queue = new Queue(fresh().driver);
  await assert.rejects(
    () => queue.dispatch(() => {}),
    /can't serialize a closure/,
  );
});

test("redis driver: a minimal connection is refused with the missing commands named", async () => {
  const minimal: RedisConnection = {
    async get() {
      return null;
    },
    async set() {},
    async del() {
      return 0;
    },
    async exists() {
      return 0;
    },
    async incrBy() {
      return 1;
    },
    async expire() {
      return false;
    },
    async ttl() {
      return -2;
    },
    async keys() {
      return [];
    },
    async flushAll() {},
  };
  const driver = new RedisDriver({ client: new Redis(minimal) });
  await assert.rejects(
    () => driver.pending(),
    /zadd, zrangebyscore, zrem, zcard, hset, hget, hgetall, hdel/,
  );
});

test("redis driver: retries, then lands in the failed hash; retryFailed revives it", async () => {
  const { driver } = fresh();
  const queue = new Queue(driver);
  Flaky.succeedOnAttempt = Infinity;

  await queue.dispatch(new Flaky());
  await queue.work(); // attempt 1 fails; noBackoff → retried in the same drain → exhausted
  assert.equal(await driver.pending(), 0);

  const failed = await driver.failedJobs();
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.job, "Flaky");
  assert.equal(failed[0]!.attempts, 2);
  assert.match(failed[0]!.error, /flaked/);

  Flaky.succeedOnAttempt = 1; // "deploy the fix"
  assert.equal(await driver.retryFailed(failed[0]!.id), true);
  assert.equal((await driver.failedJobs()).length, 0);
  await queue.work();
  assert.deepEqual(ran, ["flaky ok"]);
});

test("redis driver: backoff keeps a retry out of reach until it elapses", async () => {
  const { driver } = fresh();
  const queue = new Queue(driver);

  await queue.dispatch(new Slow());
  assert.equal(await queue.work(), 1); // attempt 1 ran (and failed)
  assert.equal(await queue.work(), 0); // the retry is a minute out
  assert.equal(await driver.pending(), 1);
});

test("redis driver: flushFailed clears one or all", async () => {
  const { driver } = fresh();
  const queue = new Queue(driver);
  Flaky.succeedOnAttempt = Infinity;

  await queue.dispatch(new Flaky());
  await queue.dispatch(new Flaky());
  await queue.work();
  const failed = await driver.failedJobs();
  assert.equal(failed.length, 2);

  assert.equal(await driver.flushFailed(failed[0]!.id), 1);
  assert.equal(await driver.flushFailed(), 1);
  assert.equal((await driver.failedJobs()).length, 0);
});

test("redis driver: an unregistered job class fails instead of crashing the worker", async () => {
  const { driver, client } = fresh();

  // Simulate a member dispatched by a process that knew a class this one doesn't.
  await client.connection.zadd!(
    "queue:jobs",
    Date.now(),
    JSON.stringify({
      id: "99",
      seq: 99,
      queue: "default",
      job: "Forgotten",
      payload: "{}",
      attempts: 0,
      maxRetries: null,
      priority: 0,
    }),
  );

  await driver.work();
  assert.equal(await driver.pending(), 0);
  const failed = await driver.failedJobs();
  assert.equal(failed.length, 1);
  assert.match(failed[0]!.error, /registerJobs\(Forgotten\)/);
});

test("redis driver: delayed jobs wait; priority orders due ones", async () => {
  const { driver } = fresh();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("later"), { delay: 60 });
  await queue.dispatch(new Greet("low"), { priority: 10 });
  await queue.dispatch(new Greet("high"), { priority: -10 });

  assert.equal(await queue.work(), 2);
  assert.deepEqual(ran, ["hello high", "hello low"]);
  assert.equal(await driver.pending(), 1); // the delayed one is still waiting
});

test("redis driver: a stale claim is released and retried", async () => {
  const { driver, client } = fresh();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("survivor"));

  // A worker claimed it and died: move the member to the reserved set with a
  // deadline already in the past.
  const conn = client.connection;
  const [member] = await conn.zrangebyscore!("queue:jobs", 0, Date.now());
  await conn.zrem!("queue:jobs", member!);
  await conn.zadd!("queue:reserved", Date.now() - 1_000, member!);

  assert.equal(await queue.work(), 1);
  assert.deepEqual(ran, ["hello survivor"]);
});

test("redis driver: two workers on one connection never run a job twice", async () => {
  const client = new Redis(new MemoryRedis());
  const a = new RedisDriver({ client });
  const b = new RedisDriver({ client });
  const queue = new Queue(a);

  for (let i = 0; i < 6; i++) await queue.dispatch(new Greet(`#${i}`));

  const [ranA, ranB] = await Promise.all([a.work(), b.work()]);
  assert.equal(ranA + ranB, 6);
  assert.equal(new Set(ran).size, 6); // each greeted exactly once
});

test("redis driver: uses the redis() global when no client is given", async () => {
  setRedis(new MemoryRedis());
  const driver = new RedisDriver();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("global"));
  assert.equal(await queue.work(), 1);
  assert.deepEqual(ran, ["hello global"]);
});
