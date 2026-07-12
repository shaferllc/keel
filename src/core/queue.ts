/**
 * A small queue for background work. Dispatch a `Job` (or a plain function) and
 * a pluggable `QueueDriver` decides when it runs — immediately (the default),
 * held in memory for a worker to drain, or handed to a real broker. The API
 * mirrors the database and mail layers (`setQueue` / `dispatch` are to queues
 * what `setConnection` / `db()` are to the database). The core imports no broker,
 * so it stays edge-safe.
 *
 *   class SendWelcome extends Job {
 *     static maxRetries = 3;
 *     constructor(private userId: number) { super(); }
 *     async handle() { await mail().to(...).send(); }
 *     async failed(error: unknown) { logger().error("welcome failed", { error }); }
 *   }
 *
 *   await dispatch(new SendWelcome(user.id));   // runs now with the sync driver
 *
 *   // Defer instead, and drain with a worker:
 *   setQueue(new MemoryDriver());
 *   await dispatch(new SendWelcome(user.id));   // queued
 *   await work();                               // runs everything pending
 *
 * A job that throws is **retried** with backoff up to `maxRetries`, and only then
 * declared failed — at which point `failed()` runs and it lands in the driver's
 * dead-letter list rather than vanishing.
 */

import { logger, hasApplication } from "./helpers.js";
import { instrument, currentRequestId } from "./instrumentation.js";

/* ---------------------------------- jobs ---------------------------------- */

/** What a job knows about its own execution while `handle()` runs. */
export interface JobContext {
  /** This dispatch's id — stable across retries. */
  jobId: string;
  /** 1 on the first run, 2 on the first retry, and so on. */
  attempt: number;
  /** The lane it was placed on. */
  queue: string;
}

/**
 * A unit of background work. Subclass and implement `handle`.
 *
 * Retry policy is per-class, via statics:
 *
 *   class ChargeCard extends Job {
 *     static maxRetries = 5;
 *     static backoff = exponentialBackoff(1_000);
 *     async handle() { … }
 *   }
 */
export abstract class Job {
  /** How many times to retry after the first failure. Default: 0 (no retries). */
  static maxRetries = 0;
  /** How long to wait before each retry. Default: exponential from 1s. */
  static backoff: Backoff = exponentialBackoff(1_000);
  /** Default lane for this job class. */
  static queue?: string;
  /** Default priority for this job class (lower runs first). */
  static priority?: number;

  /** Set by the driver before `handle()` runs. */
  context?: JobContext;

  abstract handle(): void | Promise<void>;

  /**
   * Called once the job has exhausted its retries — the last chance to record
   * the failure, alert, or compensate. A throw in here is logged and swallowed:
   * failing to handle a failure must not itself crash the worker.
   */
  failed(_error: unknown): void | Promise<void> {}
}

/** Anything dispatchable: a `Job` instance or a plain function. */
export type Dispatchable = Job | (() => void | Promise<void>);

/* -------------------------------- backoff --------------------------------- */

/** Milliseconds to wait before attempt `attempt` (1 = the first retry). */
export type Backoff = (attempt: number) => number;

/** Doubles each time: 1s, 2s, 4s, 8s… Capped at `maxMs`. */
export function exponentialBackoff(baseMs = 1_000, maxMs = 60_000): Backoff {
  return (attempt) => Math.min(baseMs * 2 ** (attempt - 1), maxMs);
}

/** Adds a fixed step each time: 5s, 10s, 15s… Capped at `maxMs`. */
export function linearBackoff(stepMs = 1_000, maxMs = 60_000): Backoff {
  return (attempt) => Math.min(stepMs * attempt, maxMs);
}

/** The same delay every time. */
export function fixedBackoff(delayMs = 1_000): Backoff {
  return () => delayMs;
}

/** No delay at all — retry straight away. */
export const noBackoff: Backoff = () => 0;

/* -------------------------------- options --------------------------------- */

export interface JobOptions {
  /** Seconds to wait before the job becomes available (drivers may honor it). */
  delay?: number;
  /** Named queue/lane to place the job on. Default: `"default"`. */
  queue?: string;
  /** Lower runs first. Default: 0. */
  priority?: number;
  /** Override the job class's `maxRetries`. */
  maxRetries?: number;
  /** Override the job class's `backoff`. */
  backoff?: Backoff;
}

/** A job sitting on a queue, with everything needed to run and retry it. */
export interface QueuedJob {
  id: string;
  job: Dispatchable;
  options: JobOptions;
  /** How many times it has been attempted so far. */
  attempts: number;
  /** Epoch ms before which it must not run (delay / backoff). */
  availableAt: number;
}

/** A job that exhausted its retries. */
export interface FailedJob {
  id: string;
  job: Dispatchable;
  options: JobOptions;
  attempts: number;
  error: unknown;
}

/** The bridge to your queue backend. */
export interface QueueDriver {
  push(job: Dispatchable, options: JobOptions): Promise<void>;
}

/** A driver that holds jobs locally and can run them on demand. */
export interface Drainable {
  readonly size: number;
  work(): Promise<number>;
}

/* ------------------------------- execution -------------------------------- */

/** The retry policy for a dispatchable, from its class statics and any overrides. */
function policy(job: Dispatchable, options: JobOptions): { maxRetries: number; backoff: Backoff } {
  const cls = job instanceof Job ? (job.constructor as typeof Job) : undefined;
  return {
    maxRetries: options.maxRetries ?? cls?.maxRetries ?? 0,
    backoff: options.backoff ?? cls?.backoff ?? exponentialBackoff(1_000),
  };
}

/** The display name of a dispatchable — its class name, or "fn" for a closure. */
function jobName(job: Dispatchable): string {
  return job instanceof Job ? job.constructor.name : "fn";
}

async function invoke(job: Dispatchable, context: JobContext): Promise<void> {
  const name = jobName(job);
  const requestId = currentRequestId();
  const start = Date.now();
  instrument("job.processing", {
    job: name,
    ...(job instanceof Job ? { payload: { ...job } } : {}),
    ...(requestId ? { requestId } : {}),
  });
  if (typeof job === "function") await job();
  else {
    job.context = context;
    await job.handle();
  }
  instrument("job.processed", {
    job: name,
    durationMs: Date.now() - start,
    ...(requestId ? { requestId } : {}),
  });
}

/**
 * Log through the application logger, falling back to the console. The queue is
 * a primitive — it has to work in a worker that never bootstrapped an
 * Application — and reporting a failure must never itself be the thing that
 * throws.
 */
function log(message: string, context: Record<string, unknown>): void {
  if (hasApplication()) logger().error(message, context);
  else console.error(message, context);
}

/**
 * A job has exhausted its retries. Log it — loudly, because a worker that keeps
 * running past a failure must not do so silently — then run the `failed()` hook.
 * A throw in the hook is logged too, never rethrown: failing to handle a failure
 * must not itself crash the worker.
 */
async function reportFailure(job: Dispatchable, error: unknown, context: JobContext): Promise<void> {
  log("queue: job failed", {
    job: jobName(job),
    jobId: context.jobId,
    attempts: context.attempt,
    queue: context.queue,
    error,
  });

  instrument("job.failed", { job: jobName(job), error });

  if (!(job instanceof Job)) return;
  try {
    await job.failed(error);
  } catch (hookError) {
    log("queue: a job's failed() hook threw", { error: hookError });
  }
}

/* -------------------------------- drivers --------------------------------- */

let counter = 0;
function nextId(): string {
  return `job_${++counter}`;
}

/**
 * Runs jobs the moment they're dispatched — the default; ideal for dev/tests.
 *
 * Retries still apply, but the backoff delay is **not** slept through: an
 * inline driver blocking the request for a 30-second backoff would be worse than
 * useless. Use `MemoryDriver` or a real broker to exercise real delays.
 */
export class SyncDriver implements QueueDriver {
  /** Jobs that exhausted their retries. */
  readonly failed: FailedJob[] = [];

  async push(job: Dispatchable, options: JobOptions): Promise<void> {
    const { maxRetries } = policy(job, options);
    const id = nextId();
    const queue = options.queue ?? "default";

    for (let attempt = 1; ; attempt++) {
      const context: JobContext = { jobId: id, attempt, queue };
      try {
        await invoke(job, context);
        return;
      } catch (error) {
        if (attempt > maxRetries) {
          await reportFailure(job, error, context);
          this.failed.push({ id, job, options, attempts: attempt, error });
          // The sync driver *is* the work — it ran inline, so the caller gets the
          // error. A background driver can't do that; it records instead.
          throw error;
        }
      }
    }
  }
}

/** Holds jobs in memory; `work()` drains them. Assert on `.jobs` in tests. */
export class MemoryDriver implements QueueDriver, Drainable {
  readonly jobs: QueuedJob[] = [];
  /** Jobs that exhausted their retries. */
  readonly failed: FailedJob[] = [];

  async push(job: Dispatchable, options: JobOptions): Promise<void> {
    this.jobs.push({
      id: nextId(),
      job,
      options,
      attempts: 0,
      availableAt: Date.now() + (options.delay ?? 0) * 1000,
    });
  }

  get size(): number {
    return this.jobs.length;
  }

  /** The next job that's due, by priority then insertion order. */
  private takeNext(now: number): QueuedJob | undefined {
    let best = -1;
    for (let i = 0; i < this.jobs.length; i++) {
      const candidate = this.jobs[i]!;
      if (candidate.availableAt > now) continue; // not due yet
      if (best === -1) {
        best = i;
        continue;
      }
      const incumbent = this.jobs[best]!;
      if ((candidate.options.priority ?? 0) < (incumbent.options.priority ?? 0)) best = i;
    }
    return best === -1 ? undefined : this.jobs.splice(best, 1)[0];
  }

  /**
   * Run every job that's currently due, highest priority first; returns how many
   * ran. A job that throws is re-queued with its backoff delay until it runs out
   * of retries, then moves to `failed`.
   *
   * Jobs whose delay or backoff hasn't elapsed are left in place — `work()`
   * drains what's *due*, it doesn't sleep. Call it again later, or advance your
   * test's clock.
   */
  async work(): Promise<number> {
    let count = 0;
    for (;;) {
      const now = Date.now();
      const next = this.takeNext(now);
      if (!next) return count;

      const { maxRetries, backoff } = policy(next.job, next.options);
      const attempt = next.attempts + 1;
      const context: JobContext = {
        jobId: next.id,
        attempt,
        queue: next.options.queue ?? "default",
      };

      try {
        await invoke(next.job, context);
        count++;
      } catch (error) {
        if (attempt > maxRetries) {
          // A failed job must not take down the worker — record it, log it, and
          // carry on with the rest of the queue.
          await reportFailure(next.job, error, context);
          this.failed.push({
            id: next.id,
            job: next.job,
            options: next.options,
            attempts: attempt,
            error,
          });
        } else {
          // Back on the queue, not runnable until the backoff has elapsed.
          this.jobs.push({
            ...next,
            attempts: attempt,
            availableAt: Date.now() + backoff(attempt),
          });
        }
        count++;
      }
    }
  }
}

/* --------------------------------- queue ---------------------------------- */

export class Queue {
  constructor(readonly driver: QueueDriver) {}

  /** Place a job on the queue (the driver decides when it runs). */
  async dispatch(job: Dispatchable, options: JobOptions = {}): Promise<void> {
    const cls = job instanceof Job ? (job.constructor as typeof Job) : undefined;
    await this.driver.push(job, {
      ...options,
      queue: options.queue ?? cls?.queue ?? "default",
      priority: options.priority ?? cls?.priority ?? 0,
    });
  }

  /** Drain the driver if it holds jobs locally; returns how many ran. */
  async work(): Promise<number> {
    const drainable = this.driver as Partial<Drainable>;
    return typeof drainable.work === "function" ? drainable.work() : 0;
  }

  /** Jobs that exhausted their retries, if the driver tracks them. */
  get failed(): FailedJob[] {
    return (this.driver as Partial<{ failed: FailedJob[] }>).failed ?? [];
  }
}

/* --------------------------------- faking --------------------------------- */

/**
 * A driver that records dispatches without running anything, plus assertions —
 * what `fakeQueue()` installs so a test can check a job was *queued* without
 * paying for it to run.
 */
export class FakeQueue extends Queue {
  readonly pushed: QueuedJob[] = [];

  constructor() {
    const pushed: QueuedJob[] = [];
    super({
      async push(job, options) {
        pushed.push({
          id: nextId(),
          job,
          options,
          attempts: 0,
          availableAt: Date.now() + (options.delay ?? 0) * 1000,
        });
      },
    });
    this.pushed = pushed;
  }

  /** Dispatches of a job class (or all of them, with no argument). */
  private matching(type?: JobClass, where?: (job: never) => boolean): QueuedJob[] {
    return this.pushed.filter((entry) => {
      if (type && !(entry.job instanceof type)) return false;
      return where ? where(entry.job as never) : true;
    });
  }

  assertPushed<T extends Job>(type: JobClass<T>, where?: (job: T) => boolean): void {
    if (this.matching(type, where as (job: never) => boolean).length) return;
    const total = this.pushed.filter((e) => e.job instanceof type).length;
    throw new Error(
      where && total
        ? `Expected a ${type.name} matching the predicate. ${total} were pushed, but none matched.`
        : `Expected ${type.name} to be pushed, but it was not. ${this.summary()}`,
    );
  }

  assertNotPushed<T extends Job>(type: JobClass<T>, where?: (job: T) => boolean): void {
    const found = this.matching(type, where as (job: never) => boolean).length;
    if (found) throw new Error(`Expected no ${type.name}, but ${found} were pushed.`);
  }

  assertPushedCount(expected: number, type?: JobClass): void {
    const found = this.matching(type).length;
    if (found !== expected) {
      const what = type ? `${type.name} job(s)` : "job(s)";
      throw new Error(`Expected ${expected} ${what} to be pushed, but ${found} were.`);
    }
  }

  assertNothingPushed(): void {
    if (this.pushed.length) {
      throw new Error(`Expected nothing to be pushed, but ${this.pushed.length} were. ${this.summary()}`);
    }
  }

  /** The queued entry for a job class — to assert on its delay, lane, or priority. */
  pushedJobs<T extends Job>(type: JobClass<T>): QueuedJob[] {
    return this.matching(type);
  }

  private summary(): string {
    if (!this.pushed.length) return "Nothing was pushed.";
    const names = [...new Set(this.pushed.map((e) => (e.job instanceof Job ? e.job.constructor.name : "fn")))];
    return `Pushed: ${names.join(", ")}.`;
  }
}

/** A `Job` subclass, as passed to the fake's assertions. */
export type JobClass<T extends Job = Job> = abstract new (...args: never[]) => T;

/* --------------------------------- global --------------------------------- */

let queue = new Queue(new SyncDriver());
let real: Queue | undefined;

/** Register the default queue driver used by `dispatch()`. */
export function setQueue(driver: QueueDriver): Queue {
  queue = new Queue(driver);
  return queue;
}

/** The default queue instance. */
export function getQueue(): Queue {
  return queue;
}

/** Dispatch a job (or function) onto the default queue. */
export function dispatch(job: Dispatchable, options?: JobOptions): Promise<void> {
  return queue.dispatch(job, options);
}

/** Drain the default queue's pending jobs (no-op for immediate drivers). */
export function work(): Promise<number> {
  return queue.work();
}

/**
 * Swap the queue for one that records dispatches without running them, so a test
 * can assert a job was queued without paying for it to run. Undo with
 * `restoreQueue()`.
 *
 *   const q = fakeQueue();
 *   await register(user);
 *   q.assertPushed(SendWelcome, (job) => job.userId === user.id);
 */
export function fakeQueue(): FakeQueue {
  if (!real) real = queue; // only remember the *real* queue — faking twice must not stash a fake
  const fake = new FakeQueue();
  queue = fake;
  return fake;
}

/** Restore the real queue after `fakeQueue()`. */
export function restoreQueue(): void {
  if (real) queue = real;
  real = undefined;
}
