/**
 * A small queue for background work. Dispatch a `Job` (or a plain function) and
 * a pluggable `QueueDriver` decides when it runs — immediately (the default),
 * held in memory for a worker to drain, persisted so it survives a restart
 * (`DatabaseDriver` as rows, `RedisDriver` in sorted sets), or handed to a
 * real broker. The API
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
import { db, type Row } from "./database.js";
import { redis, type Redis, type RedisConnection } from "./redis.js";

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

/* ---------------------------- the database driver -------------------------- */

/**
 * Job classes the database driver may rehydrate, keyed by class name. A job
 * pulled off a database queue is only a class name and a JSON payload;
 * registration is what turns the name back into a constructor — a worker
 * process can't reach into the dispatching process's closures.
 */
const jobClasses = new Map<string, JobClass>();

/**
 * Register job classes so a worker can rebuild them from their stored payload.
 * Call it once at boot (a provider's `register()`), in both the process that
 * dispatches and the one that runs `queue:work` — they are often not the same.
 *
 *   registerJobs(SendWelcome, ChargeCard);
 */
export function registerJobs(...classes: JobClass[]): void {
  for (const cls of classes) jobClasses.set(cls.name, cls);
}

/** The instance's own state, minus driver bookkeeping — what gets stored. */
function serialize(job: Job): string {
  const payload: Record<string, unknown> = { ...job };
  delete payload.context;
  return JSON.stringify(payload);
}

/** Rebuild a Job from its class name and stored payload, bypassing the constructor. */
function hydrate(name: string, payload: string): Job {
  const cls = jobClasses.get(name);
  if (!cls) {
    throw new Error(
      `queue: no job class registered as "${name}" — call registerJobs(${name}) at boot so the worker can rebuild it.`,
    );
  }
  const job = Object.create(cls.prototype) as Job;
  Object.assign(job, JSON.parse(payload));
  return job;
}

/** A failed job as a database driver stores it — inspectable and retryable. */
export interface FailedJobRecord {
  id: number | string;
  queue: string;
  /** The job's class name. */
  job: string;
  payload: string;
  attempts: number;
  error: string;
  /** Epoch ms. */
  failedAt: number;
}

/** A driver that persists failures — what `queue:failed` / `queue:retry` drive. */
export interface FailedJobStore {
  failedJobs(): Promise<FailedJobRecord[]>;
  /** Move a failed job back onto the queue. Returns whether it was found. */
  retryFailed(id: number | string): Promise<boolean>;
  /** Delete failed jobs — one, or all of them. Returns how many were removed. */
  flushFailed(id?: number | string): Promise<number>;
}

export interface DatabaseDriverOptions {
  /** Pending-jobs table. Default: `"jobs"`. */
  table?: string;
  /** Failed-jobs table. Default: `"failed_jobs"`. */
  failedTable?: string;
  /** Named connection to use. Default: the default connection. */
  connection?: string;
  /**
   * Seconds after which a reserved-but-unfinished job is released for another
   * attempt — the escape hatch for a worker that died mid-job. Must be longer
   * than your slowest job, or it will run twice. Default: 300.
   */
  staleAfter?: number;
}

/**
 * A queue that survives a restart: jobs live in a database table, workers claim
 * them atomically, and exhausted jobs land in a failed-jobs table where
 * `queue:failed` / `queue:retry` can see them. Built on the `db()` layer, so it
 * runs anywhere a `Connection` does — Node, D1, Postgres, libSQL.
 *
 *   setQueue(new DatabaseDriver());
 *   registerJobs(SendWelcome);            // in the worker too
 *   await dispatch(new SendWelcome(user.id));
 *
 * Two constraints follow from jobs being *rows*: only `Job` subclasses can be
 * dispatched (a closure can't be serialized), and a per-dispatch `backoff`
 * override can't cross the process boundary (a function isn't data) — backoff
 * comes from the job class; `maxRetries` overrides are stored and honored.
 */
export class DatabaseDriver implements QueueDriver, FailedJobStore {
  private table: string;
  private failedTable: string;
  private connection?: string;
  private staleAfter: number;

  constructor(options: DatabaseDriverOptions = {}) {
    this.table = options.table ?? "jobs";
    this.failedTable = options.failedTable ?? "failed_jobs";
    if (options.connection !== undefined) this.connection = options.connection;
    this.staleAfter = options.staleAfter ?? 300;
  }

  private jobs() {
    return db(this.table, this.connection);
  }

  private failed() {
    return db(this.failedTable, this.connection);
  }

  async push(job: Dispatchable, options: JobOptions): Promise<void> {
    if (!(job instanceof Job)) {
      throw new Error(
        "queue: the database driver can't serialize a closure — dispatch a Job subclass (and registerJobs() it) instead.",
      );
    }
    await this.jobs().insert({
      queue: options.queue ?? "default",
      job: job.constructor.name,
      payload: serialize(job),
      attempts: 0,
      max_retries: options.maxRetries ?? null,
      priority: options.priority ?? 0,
      available_at: Date.now() + (options.delay ?? 0) * 1000,
      reserved_at: null,
      created_at: Date.now(),
    });
  }

  /** How many jobs are waiting to run (not currently reserved by a worker). */
  async pending(): Promise<number> {
    return this.jobs().whereNull("reserved_at").count();
  }

  /**
   * Run every job that's currently due; returns how many ran. Safe to call from
   * several workers at once — a job is claimed with an atomic conditional
   * update, so exactly one worker gets it.
   */
  async work(): Promise<number> {
    await this.releaseStale();
    let count = 0;
    for (;;) {
      const row = await this.claim();
      if (!row) return count;
      await this.run(row);
      count++;
    }
  }

  /** Free jobs whose worker vanished mid-run, so they aren't reserved forever. */
  private async releaseStale(): Promise<void> {
    await this.jobs()
      .whereNotNull("reserved_at")
      .where("reserved_at", "<", Date.now() - this.staleAfter * 1000)
      .update({ reserved_at: null });
  }

  /** The next due job, claimed. Loses a race gracefully: it just tries the next one. */
  private async claim(): Promise<Row | null> {
    for (;;) {
      const row = await this.jobs()
        .whereNull("reserved_at")
        .where("available_at", "<=", Date.now())
        .orderBy("priority")
        .orderBy("id")
        .first();
      if (!row) return null;

      const { rowsAffected } = await this.jobs()
        .where("id", row.id as number)
        .whereNull("reserved_at")
        .update({ reserved_at: Date.now() });
      if (rowsAffected) return row;
      // Another worker got there first — claim the next one instead.
    }
  }

  private async run(row: Row): Promise<void> {
    const attempt = Number(row.attempts) + 1;
    const context: JobContext = {
      jobId: String(row.id),
      attempt,
      queue: String(row.queue),
    };

    let job: Job;
    try {
      job = hydrate(String(row.job), String(row.payload));
    } catch (error) {
      // An unregistered class can never run — no amount of retrying fixes a
      // missing registerJobs() call. Straight to the failed table, loudly.
      log("queue: job failed", { job: String(row.job), jobId: context.jobId, error });
      instrument("job.failed", { job: String(row.job), error });
      await this.moveToFailed(row, attempt, error);
      return;
    }

    try {
      await invoke(job, context);
      await this.jobs().where("id", row.id as number).delete();
    } catch (error) {
      const stored = row.max_retries;
      const { maxRetries, backoff } = policy(job, {
        ...(stored != null ? { maxRetries: Number(stored) } : {}),
      });
      if (attempt > maxRetries) {
        await reportFailure(job, error, context);
        await this.moveToFailed(row, attempt, error);
      } else {
        // Back on the queue, not runnable until the backoff has elapsed.
        await this.jobs().where("id", row.id as number).update({
          attempts: attempt,
          reserved_at: null,
          available_at: Date.now() + backoff(attempt),
        });
      }
    }
  }

  private async moveToFailed(row: Row, attempts: number, error: unknown): Promise<void> {
    await this.failed().insert({
      queue: row.queue,
      job: row.job,
      payload: row.payload,
      priority: row.priority ?? 0,
      attempts,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      failed_at: Date.now(),
    });
    await this.jobs().where("id", row.id as number).delete();
  }

  async failedJobs(): Promise<FailedJobRecord[]> {
    const rows = await this.failed().orderBy("id").get();
    return rows.map((row) => ({
      id: row.id as number | string,
      queue: String(row.queue),
      job: String(row.job),
      payload: String(row.payload),
      attempts: Number(row.attempts),
      error: String(row.error),
      failedAt: Number(row.failed_at),
    }));
  }

  async retryFailed(id: number | string): Promise<boolean> {
    const row = await this.failed().where("id", id).first();
    if (!row) return false;
    await this.jobs().insert({
      queue: row.queue,
      job: row.job,
      payload: row.payload,
      attempts: 0,
      max_retries: null,
      priority: row.priority ?? 0,
      available_at: Date.now(),
      reserved_at: null,
      created_at: Date.now(),
    });
    await this.failed().where("id", id).delete();
    return true;
  }

  async flushFailed(id?: number | string): Promise<number> {
    const query = id === undefined ? this.failed() : this.failed().where("id", id);
    const { rowsAffected } = await query.delete();
    return rowsAffected;
  }
}

/** Schema for the database driver's two tables — add it to your migrations. */
export function queueMigration(table = "jobs", failedTable = "failed_jobs"): import("./migrations.js").Migration {
  return {
    name: `queue_00_${table}`,
    async up(schema) {
      await schema.createTable(table, (t) => {
        t.id();
        t.string("queue").default("default");
        t.string("job");
        t.text("payload");
        t.integer("attempts").default(0);
        t.integer("max_retries").nullable();
        t.integer("priority").default(0);
        t.bigInteger("available_at");
        t.bigInteger("reserved_at").nullable();
        t.bigInteger("created_at");
        t.index(["queue", "reserved_at", "available_at"]);
      });
      await schema.createTable(failedTable, (t) => {
        t.id();
        t.string("queue");
        t.string("job");
        t.text("payload");
        t.integer("priority").default(0);
        t.integer("attempts");
        t.text("error");
        t.bigInteger("failed_at");
      });
    },
    async down(schema) {
      await schema.dropTable(failedTable);
      await schema.dropTable(table);
    },
  };
}

/* ----------------------------- the redis driver ---------------------------- */

/** A job as it lives inside a Redis sorted-set member (JSON-encoded). */
interface RedisJobRecord {
  id: string;
  /** Monotonic sequence — the stable tiebreak within equal priority. */
  seq: number;
  queue: string;
  /** The job's class name. */
  job: string;
  payload: string;
  attempts: number;
  /** A per-dispatch `maxRetries` override, if one was given. */
  maxRetries: number | null;
  priority: number;
}

/** The sorted-set / hash commands the driver runs on. */
const REDIS_QUEUE_COMMANDS = [
  "zadd",
  "zrangebyscore",
  "zrem",
  "zcard",
  "hset",
  "hget",
  "hgetall",
  "hdel",
] as const;

type RedisQueueConnection = RedisConnection &
  Required<Pick<RedisConnection, (typeof REDIS_QUEUE_COMMANDS)[number]>>;

export interface RedisDriverOptions {
  /** The client to use. Default: the `redis()` global. */
  client?: Redis;
  /** Key prefix. Default: `"queue"` → `queue:jobs`, `queue:reserved`, `queue:failed`. */
  prefix?: string;
  /**
   * Seconds after which a claimed-but-unfinished job is released for another
   * attempt — the escape hatch for a worker that died mid-job. Must be longer
   * than your slowest job, or it will run twice. Default: 300.
   */
  staleAfter?: number;
}

/**
 * A queue in Redis: pending jobs in a sorted set scored by when they become
 * due, claims in a second set scored by their deadline, failures in a hash.
 * Same durability contract as `DatabaseDriver` — jobs survive a restart,
 * several workers can share the keys, exhausted jobs are retryable — with
 * Redis's latency instead of a SQL round-trip.
 *
 *   setRedis(myAdapter);            // ioredis, node-redis, Upstash…
 *   setQueue(new RedisDriver());
 *   registerJobs(SendWelcome);      // in the worker too
 *
 * A claim is `ZREM` — atomic per command, so exactly one worker removes any
 * member and no Lua script is required, which keeps HTTP adapters (Upstash) in
 * play. The same serialization rules as the database driver apply: `Job`
 * subclasses only, class-level backoff.
 */
export class RedisDriver implements QueueDriver, FailedJobStore {
  private client?: Redis;
  private prefix: string;
  private staleAfter: number;

  constructor(options: RedisDriverOptions = {}) {
    if (options.client !== undefined) this.client = options.client;
    this.prefix = options.prefix ?? "queue";
    this.staleAfter = options.staleAfter ?? 300;
  }

  private get jobsKey(): string {
    return `${this.prefix}:jobs`;
  }
  private get reservedKey(): string {
    return `${this.prefix}:reserved`;
  }
  private get failedKey(): string {
    return `${this.prefix}:failed`;
  }

  /** The connection, verified to speak the sorted-set/hash commands we need. */
  private conn(): RedisQueueConnection {
    const conn = (this.client ?? redis()).connection;
    const missing = REDIS_QUEUE_COMMANDS.filter((cmd) => typeof conn[cmd] !== "function");
    if (missing.length) {
      throw new Error(
        `queue: the Redis connection doesn't implement ${missing.join(", ")} — ` +
          "add them to your RedisConnection adapter (each is one standard Redis command).",
      );
    }
    return conn as RedisQueueConnection;
  }

  private async nextRecordId(): Promise<number> {
    return this.conn().incrBy(`${this.prefix}:seq`, 1);
  }

  async push(job: Dispatchable, options: JobOptions): Promise<void> {
    if (!(job instanceof Job)) {
      throw new Error(
        "queue: the redis driver can't serialize a closure — dispatch a Job subclass (and registerJobs() it) instead.",
      );
    }
    const seq = await this.nextRecordId();
    const record: RedisJobRecord = {
      id: String(seq),
      seq,
      queue: options.queue ?? "default",
      job: job.constructor.name,
      payload: serialize(job),
      attempts: 0,
      maxRetries: options.maxRetries ?? null,
      priority: options.priority ?? 0,
    };
    await this.conn().zadd(this.jobsKey, Date.now() + (options.delay ?? 0) * 1000, JSON.stringify(record));
  }

  /** How many jobs are waiting to run (not currently claimed by a worker). */
  async pending(): Promise<number> {
    return this.conn().zcard(this.jobsKey);
  }

  /**
   * Run every job that's currently due; returns how many ran. Safe to call from
   * several workers at once — `ZREM` removes a member exactly once, so a job
   * has exactly one claimant.
   */
  async work(): Promise<number> {
    await this.releaseStale();
    let count = 0;
    for (;;) {
      const claimed = await this.claim();
      if (!claimed) return count;
      await this.run(claimed.record, claimed.member);
      count++;
    }
  }

  /** Free jobs whose worker vanished mid-run, so they aren't claimed forever. */
  private async releaseStale(): Promise<void> {
    const conn = this.conn();
    for (const member of await conn.zrangebyscore(this.reservedKey, 0, Date.now())) {
      // Only the one who removes the reservation gets to requeue it.
      if (await conn.zrem(this.reservedKey, member)) {
        await conn.zadd(this.jobsKey, Date.now(), member);
      }
    }
  }

  /**
   * The next due job, claimed. Fetches a batch of due members, orders them by
   * priority then dispatch order, and races `ZREM` — losing to another worker
   * just means trying the next one.
   */
  private async claim(): Promise<{ record: RedisJobRecord; member: string } | null> {
    const conn = this.conn();
    for (;;) {
      const due = await conn.zrangebyscore(this.jobsKey, 0, Date.now(), 32);
      if (!due.length) return null;

      const candidates = due
        .map((member) => ({ member, record: JSON.parse(member) as RedisJobRecord }))
        .sort((a, b) => a.record.priority - b.record.priority || a.record.seq - b.record.seq);

      for (const candidate of candidates) {
        if (await conn.zrem(this.jobsKey, candidate.member)) {
          await conn.zadd(this.reservedKey, Date.now() + this.staleAfter * 1000, candidate.member);
          return candidate;
        }
      }
      // Every candidate went to other workers — look again.
    }
  }

  private async run(record: RedisJobRecord, member: string): Promise<void> {
    const conn = this.conn();
    const attempt = record.attempts + 1;
    const context: JobContext = { jobId: record.id, attempt, queue: record.queue };

    let job: Job;
    try {
      job = hydrate(record.job, record.payload);
    } catch (error) {
      // An unregistered class can never run — no amount of retrying fixes a
      // missing registerJobs() call. Straight to the failed hash, loudly.
      log("queue: job failed", { job: record.job, jobId: record.id, error });
      instrument("job.failed", { job: record.job, error });
      await this.moveToFailed(record, attempt, error, member);
      return;
    }

    try {
      await invoke(job, context);
      await conn.zrem(this.reservedKey, member);
    } catch (error) {
      const { maxRetries, backoff } = policy(job, {
        ...(record.maxRetries != null ? { maxRetries: record.maxRetries } : {}),
      });
      if (attempt > maxRetries) {
        await reportFailure(job, error, context);
        await this.moveToFailed(record, attempt, error, member);
      } else {
        // Back on the queue, not runnable until the backoff has elapsed.
        await conn.zrem(this.reservedKey, member);
        await conn.zadd(
          this.jobsKey,
          Date.now() + backoff(attempt),
          JSON.stringify({ ...record, attempts: attempt }),
        );
      }
    }
  }

  private async moveToFailed(
    record: RedisJobRecord,
    attempts: number,
    error: unknown,
    member: string,
  ): Promise<void> {
    await this.conn().hset(
      this.failedKey,
      record.id,
      JSON.stringify({
        id: record.id,
        queue: record.queue,
        job: record.job,
        payload: record.payload,
        priority: record.priority,
        attempts,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        failedAt: Date.now(),
      }),
    );
    await this.conn().zrem(this.reservedKey, member);
  }

  async failedJobs(): Promise<FailedJobRecord[]> {
    const all = await this.conn().hgetall(this.failedKey);
    return Object.values(all)
      .map((raw) => JSON.parse(raw) as FailedJobRecord & { priority: number })
      .sort((a, b) => a.failedAt - b.failedAt || String(a.id).localeCompare(String(b.id)));
  }

  async retryFailed(id: number | string): Promise<boolean> {
    const conn = this.conn();
    const raw = await conn.hget(this.failedKey, String(id));
    if (raw == null) return false;
    const failed = JSON.parse(raw) as FailedJobRecord & { priority: number };

    const seq = await this.nextRecordId();
    const record: RedisJobRecord = {
      id: String(seq),
      seq,
      queue: failed.queue,
      job: failed.job,
      payload: failed.payload,
      attempts: 0,
      maxRetries: null,
      priority: failed.priority ?? 0,
    };
    await conn.zadd(this.jobsKey, Date.now(), JSON.stringify(record));
    await conn.hdel(this.failedKey, String(id));
    return true;
  }

  async flushFailed(id?: number | string): Promise<number> {
    const conn = this.conn();
    if (id !== undefined) return conn.hdel(this.failedKey, String(id));
    const count = Object.keys(await conn.hgetall(this.failedKey)).length;
    await conn.del(this.failedKey);
    return count;
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
