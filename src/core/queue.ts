/**
 * A small queue for background work. Dispatch a `Job` (or a plain function) and
 * a pluggable `QueueDriver` decides when it runs — immediately (the default),
 * held in memory for a worker to drain, or handed to a real broker. The API
 * mirrors the database and mail layers (`setQueue` / `dispatch` are to queues
 * what `setConnection` / `db()` are to the database). The core imports no broker,
 * so it stays edge-safe.
 *
 *   class SendWelcome extends Job {
 *     constructor(private userId: number) { super(); }
 *     async handle() { await mail().to(...).send(); }
 *   }
 *
 *   await dispatch(new SendWelcome(user.id));   // runs now with the sync driver
 *
 *   // Defer instead, and drain with a worker:
 *   setQueue(new MemoryDriver());
 *   await dispatch(new SendWelcome(user.id));   // queued
 *   await work();                               // runs everything pending
 */

/** A unit of background work. Subclass and implement `handle`. */
export abstract class Job {
  abstract handle(): void | Promise<void>;
}

/** Anything dispatchable: a `Job` instance or a plain function. */
export type Dispatchable = Job | (() => void | Promise<void>);

export interface JobOptions {
  /** Seconds to wait before the job becomes available (drivers may honor it). */
  delay?: number;
  /** Named queue/lane to place the job on. */
  queue?: string;
}

function run(job: Dispatchable): Promise<void> {
  return Promise.resolve(job instanceof Job ? job.handle() : job());
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

/* -------------------------------- drivers --------------------------------- */

/** Runs jobs the moment they're dispatched — the default; ideal for dev/tests. */
export class SyncDriver implements QueueDriver {
  async push(job: Dispatchable, _options: JobOptions): Promise<void> {
    await run(job);
  }
}

export interface QueuedJob {
  job: Dispatchable;
  options: JobOptions;
}

/** Holds jobs in memory; `work()` drains them. Assert on `.jobs` in tests. */
export class MemoryDriver implements QueueDriver, Drainable {
  readonly jobs: QueuedJob[] = [];

  async push(job: Dispatchable, options: JobOptions): Promise<void> {
    this.jobs.push({ job, options });
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Run every pending job in FIFO order; returns how many ran. */
  async work(): Promise<number> {
    let count = 0;
    while (this.jobs.length) {
      const next = this.jobs.shift()!;
      await run(next.job);
      count++;
    }
    return count;
  }
}

/* --------------------------------- queue ---------------------------------- */

export class Queue {
  constructor(readonly driver: QueueDriver) {}

  /** Place a job on the queue (the driver decides when it runs). */
  async dispatch(job: Dispatchable, options: JobOptions = {}): Promise<void> {
    await this.driver.push(job, options);
  }

  /** Drain the driver if it holds jobs locally; returns how many ran. */
  async work(): Promise<number> {
    const drainable = this.driver as Partial<Drainable>;
    return typeof drainable.work === "function" ? drainable.work() : 0;
  }
}

/* --------------------------------- global --------------------------------- */

let queue = new Queue(new SyncDriver());

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
