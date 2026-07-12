import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Job,
  Queue,
  SyncDriver,
  MemoryDriver,
  dispatch,
  work,
  setQueue,
  getQueue,
  fakeQueue,
  restoreQueue,
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  noBackoff,
} from "../src/core/queue.js";

class RecordJob extends Job {
  constructor(
    private log: string[],
    private tag: string,
  ) {
    super();
  }
  async handle() {
    this.log.push(this.tag);
  }
}

test("sync driver runs jobs immediately on dispatch", async () => {
  setQueue(new SyncDriver());
  const log: string[] = [];
  await dispatch(new RecordJob(log, "a"));
  assert.deepEqual(log, ["a"]); // ran before dispatch resolved
});

test("dispatch accepts a plain function", async () => {
  setQueue(new SyncDriver());
  let ran = false;
  await dispatch(() => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("memory driver defers jobs until work() drains them", async () => {
  const driver = new MemoryDriver();
  setQueue(driver);
  const log: string[] = [];

  await dispatch(new RecordJob(log, "a"));
  await dispatch(new RecordJob(log, "b"));

  assert.equal(driver.size, 2);
  assert.deepEqual(log, []); // nothing ran yet

  const count = await work();
  assert.equal(count, 2);
  assert.deepEqual(log, ["a", "b"]); // FIFO
  assert.equal(driver.size, 0);
});

test("memory driver exposes queued jobs and their options", async () => {
  const driver = new MemoryDriver();
  setQueue(driver);
  const job = new RecordJob([], "x");
  await dispatch(job, { delay: 60, queue: "emails" });

  assert.equal(driver.jobs.length, 1);
  assert.equal(driver.jobs[0]!.job, job);
  // dispatch() materializes the defaults, so `queue` and `priority` are always set.
  assert.deepEqual(driver.jobs[0]!.options, { delay: 60, queue: "emails", priority: 0 });
});

test("work() is a no-op for immediate drivers", async () => {
  setQueue(new SyncDriver());
  assert.equal(await work(), 0);
});

test("a job error propagates to the caller", async () => {
  setQueue(new SyncDriver());
  class Boom extends Job {
    async handle() {
      throw new Error("kaboom");
    }
  }
  await assert.rejects(() => dispatch(new Boom()), /kaboom/);
});

test("a failing job does not take down the worker — it lands in `failed`", async () => {
  const driver = new MemoryDriver();
  setQueue(driver);

  await dispatch(() => {
    throw new Error("in worker");
  });
  await dispatch(() => {}); // a healthy job behind it

  // work() must not reject: one bad job cannot stop a worker draining the queue.
  const ran = await work();
  assert.equal(ran, 2, "the healthy job still ran");

  assert.equal(driver.failed.length, 1);
  assert.equal((driver.failed[0]!.error as Error).message, "in worker");
  assert.equal(driver.jobs.length, 0);
});

test("the sync driver still throws — it ran the job inline, so the caller gets the error", async () => {
  setQueue(new SyncDriver());
  await assert.rejects(
    () =>
      dispatch(() => {
        throw new Error("inline");
      }),
    /inline/,
  );
});

test("getQueue exposes the active queue and its driver", () => {
  const driver = new MemoryDriver();
  setQueue(driver);
  const q = getQueue();
  assert.ok(q instanceof Queue);
  assert.equal(q.driver, driver);
});

test("a custom driver receives dispatched jobs", async () => {
  const received: unknown[] = [];
  setQueue({
    async push(job) {
      received.push(job);
    },
  });
  const job = new RecordJob([], "z");
  await dispatch(job);
  assert.equal(received[0], job);
});

/* -------------------------------- backoff --------------------------------- */

test("backoff strategies produce the documented delays", () => {
  const exp = exponentialBackoff(1_000);
  assert.deepEqual([1, 2, 3, 4].map(exp), [1_000, 2_000, 4_000, 8_000]);

  // ...and cap out.
  assert.equal(exponentialBackoff(1_000, 5_000)(10), 5_000);

  const lin = linearBackoff(5_000);
  assert.deepEqual([1, 2, 3].map(lin), [5_000, 10_000, 15_000]);
  assert.equal(linearBackoff(5_000, 12_000)(9), 12_000);

  const fixed = fixedBackoff(2_000);
  assert.deepEqual([1, 2, 3].map(fixed), [2_000, 2_000, 2_000]);

  assert.equal(noBackoff(3), 0);
});

/* -------------------------------- retries --------------------------------- */

test("a job is retried up to maxRetries, then fails", async () => {
  let attempts = 0;

  class Flaky extends Job {
    static override maxRetries = 2;
    static override backoff = noBackoff; // don't make the test wait
    failures: unknown[] = [];

    async handle(): Promise<void> {
      attempts++;
      throw new Error(`attempt ${attempts}`);
    }
    override failed(error: unknown): void {
      this.failures.push(error);
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);

  const job = new Flaky();
  await dispatch(job);
  await work();

  // 1 initial attempt + 2 retries.
  assert.equal(attempts, 3);
  assert.equal(driver.failed.length, 1);
  assert.equal(driver.failed[0]!.attempts, 3);
  assert.equal((driver.failed[0]!.error as Error).message, "attempt 3");

  // failed() ran exactly once, after the retries were exhausted.
  assert.equal(job.failures.length, 1);
});

test("a job that succeeds on a retry does not fail", async () => {
  let attempts = 0;

  class EventuallyFine extends Job {
    static override maxRetries = 3;
    static override backoff = noBackoff;

    async handle(): Promise<void> {
      attempts++;
      if (attempts < 3) throw new Error("not yet");
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);

  await dispatch(new EventuallyFine());
  await work();

  assert.equal(attempts, 3);
  assert.equal(driver.failed.length, 0);
  assert.equal(driver.jobs.length, 0);
});

test("a job with no retries fails on the first throw", async () => {
  class Once extends Job {
    async handle(): Promise<void> {
      throw new Error("nope");
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new Once());
  await work();

  assert.equal(driver.failed.length, 1);
  assert.equal(driver.failed[0]!.attempts, 1);
});

test("a backoff delay keeps the retry out of the current drain", async () => {
  let attempts = 0;

  class Slow extends Job {
    static override maxRetries = 1;
    static override backoff = fixedBackoff(10_000); // far beyond the test

    async handle(): Promise<void> {
      attempts++;
      throw new Error("fail");
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new Slow());

  await work();
  assert.equal(attempts, 1, "the retry must not run until the backoff elapses");
  assert.equal(driver.jobs.length, 1, "it is back on the queue, waiting");
  assert.equal(driver.failed.length, 0);

  // Draining again changes nothing while the backoff is still pending.
  await work();
  assert.equal(attempts, 1);
});

test("options can override the job class's retry policy", async () => {
  let attempts = 0;

  class Fixed extends Job {
    static override maxRetries = 0;
    async handle(): Promise<void> {
      attempts++;
      throw new Error("fail");
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new Fixed(), { maxRetries: 2, backoff: noBackoff });
  await work();

  assert.equal(attempts, 3);
});

test("the failed() hook throwing does not break the worker", async () => {
  class Bad extends Job {
    async handle(): Promise<void> {
      throw new Error("job failed");
    }
    override failed(): void {
      throw new Error("hook failed too");
    }
  }

  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new Bad());

  await work(); // must not reject
  assert.equal(driver.failed.length, 1);
});

/* ------------------------------ job context ------------------------------- */

test("a job can read its id, attempt, and queue while it runs", async () => {
  const seen: Array<{ attempt: number; queue: string; hasId: boolean }> = [];

  class Contextual extends Job {
    static override maxRetries = 1;
    static override backoff = noBackoff;

    async handle(): Promise<void> {
      seen.push({
        attempt: this.context!.attempt,
        queue: this.context!.queue,
        hasId: Boolean(this.context!.jobId),
      });
      if (seen.length === 1) throw new Error("retry me");
    }
  }

  setQueue(new MemoryDriver());
  await dispatch(new Contextual(), { queue: "emails" });
  await work();

  assert.deepEqual(seen, [
    { attempt: 1, queue: "emails", hasId: true },
    { attempt: 2, queue: "emails", hasId: true },
  ]);
});

/* -------------------------------- priority -------------------------------- */

test("lower priority numbers run first", async () => {
  const order: string[] = [];
  const driver = new MemoryDriver();
  setQueue(driver);

  await dispatch(() => void order.push("normal"));
  await dispatch(() => void order.push("urgent"), { priority: -10 });
  await dispatch(() => void order.push("low"), { priority: 10 });

  await work();
  assert.deepEqual(order, ["urgent", "normal", "low"]);
});

test("a job class can declare its own queue and priority", async () => {
  class Urgent extends Job {
    static override queue = "critical";
    static override priority = -5;
    async handle(): Promise<void> {}
  }

  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new Urgent());

  assert.equal(driver.jobs[0]!.options.queue, "critical");
  assert.equal(driver.jobs[0]!.options.priority, -5);
});

/* --------------------------------- delays --------------------------------- */

test("a delayed job is not due yet, so work() leaves it alone", async () => {
  const driver = new MemoryDriver();
  setQueue(driver);

  let ran = false;
  await dispatch(() => void (ran = true), { delay: 60 });

  assert.equal(await work(), 0);
  assert.equal(ran, false);
  assert.equal(driver.jobs.length, 1);
});

/* --------------------------------- faking --------------------------------- */

class SendWelcome extends Job {
  constructor(readonly userId: number) {
    super();
  }
  async handle(): Promise<void> {
    throw new Error("the fake must never run this");
  }
}

class SendInvoice extends Job {
  async handle(): Promise<void> {}
}

test("fakeQueue records dispatches without running them", async () => {
  const q = fakeQueue();

  await dispatch(new SendWelcome(7));

  q.assertPushed(SendWelcome);
  q.assertPushed(SendWelcome, (job) => job.userId === 7);
  q.assertNotPushed(SendInvoice);
  q.assertPushedCount(1);
  q.assertPushedCount(1, SendWelcome);
  q.assertPushedCount(0, SendInvoice);

  restoreQueue();
});

test("fake assertions fail with a useful message", async () => {
  const q = fakeQueue();
  await dispatch(new SendWelcome(7));

  assert.throws(() => q.assertNotPushed(SendWelcome), /Expected no SendWelcome, but 1 were pushed/);
  assert.throws(() => q.assertPushed(SendInvoice), /Expected SendInvoice to be pushed/);
  assert.throws(() => q.assertPushedCount(3), /Expected 3 job\(s\).*but 1 were/);
  assert.throws(() => q.assertNothingPushed(), /Expected nothing to be pushed, but 1 were/);
  assert.throws(
    () => q.assertPushed(SendWelcome, (job) => job.userId === 99),
    /1 were pushed, but none matched/,
  );

  restoreQueue();
});

test("assertNothingPushed passes on an untouched fake", () => {
  const q = fakeQueue();
  q.assertNothingPushed();
  restoreQueue();
});

test("the fake records options, so delay and lane can be asserted", async () => {
  const q = fakeQueue();
  await dispatch(new SendWelcome(1), { delay: 300, queue: "emails" });

  const [entry] = q.pushedJobs(SendWelcome);
  assert.equal(entry!.options.delay, 300);
  assert.equal(entry!.options.queue, "emails");

  restoreQueue();
});

test("restoreQueue brings the real queue back, and faking twice is safe", async () => {
  const driver = new MemoryDriver();
  const real = setQueue(driver);

  fakeQueue();
  fakeQueue();
  restoreQueue();

  assert.equal(getQueue(), real);

  await dispatch(() => {});
  assert.equal(driver.jobs.length, 1); // the real driver is back in play
});
