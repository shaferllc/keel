# Queues & Jobs

Move slow work — sending mail, calling an API, processing an upload — off the
request path. You `dispatch` a **job** and a pluggable **driver** decides when it
runs: immediately (the default), held in memory for a worker to drain, or handed
to a real broker. The API mirrors the database and mail layers (`setQueue` /
`dispatch` are to queues what `setConnection` / `db()` are to the database), and
the core imports no broker, so it stays edge-safe.

## Defining a job

A job is a class with a `handle()` method. Pass whatever data it needs through
the constructor:

```ts
import { Job, mail } from "@shaferllc/keel/core";

export class SendWelcome extends Job {
  constructor(private email: string) {
    super();
  }
  async handle() {
    await mail().to(this.email).subject("Welcome").text("Glad you're here").send();
  }
}
```

Generate one with `keel make:job SendWelcome` (→ `app/Jobs/SendWelcomeJob.ts`).

## Dispatching

```ts
import { dispatch } from "@shaferllc/keel/core";

await dispatch(new SendWelcome(user.email));

// options: delay (seconds) and a named lane — honored by drivers that support them
await dispatch(new SendWelcome(user.email), { delay: 60, queue: "emails" });

// a plain function works too, for one-off work
await dispatch(() => rebuildSearchIndex());
```

Out of the box `dispatch` runs against a `SyncDriver`, so a fresh app executes
jobs inline — no setup, no worker. Call `setQueue` once to defer instead.
`dispatch` returns a promise that resolves when the driver has accepted the job
(for `SyncDriver` that means *after* the job has run; for a deferring driver, as
soon as it's enqueued).

`MemoryDriver` honors `delay` and `priority`; `SyncDriver` runs inline and so
ignores both. `queue` is a lane label that a real broker driver acts on.

## Drivers

Register the default driver once (typically in a service provider):

```ts
import { setQueue, SyncDriver, MemoryDriver } from "@shaferllc/keel/core";

setQueue(new SyncDriver());   // the default — runs jobs immediately
setQueue(new MemoryDriver()); // holds jobs; a worker drains them
```

| Driver | Behavior |
|--------|----------|
| `SyncDriver` | Runs each job the instant it's dispatched. The default; great for dev and tests. |
| `MemoryDriver` | Enqueues jobs in memory; `work()` runs them. Inspect `.jobs` / `.size`. |
| `DatabaseDriver` | Jobs are rows — they survive a restart, workers claim them atomically, failures persist. |
| `RedisDriver` | The same durability contract in Redis — sorted sets and a failed hash, claims via atomic `ZREM`. |

With the sync driver, a job that throws surfaces the error to whoever called
`dispatch` — so failures are visible in development.

## The database driver

Memory empties on every restart. When a queued job must *survive* — a deploy, a
crash, a Worker eviction — make it a row. The driver is built on the `db()`
layer, so it runs anywhere a `Connection` does (Postgres, D1, libSQL, SQLite):

```ts
import { setQueue, DatabaseDriver, registerJobs, queueMigration } from "@shaferllc/keel/core";

// database/migrations/0005_queue_tables.ts — the jobs + failed_jobs tables
export default queueMigration();

// a provider's register(), in BOTH the web process and the worker
registerJobs(SendWelcome, ChargeCard);
setQueue(new DatabaseDriver());
```

Run the worker with `keel queue:work` (poll forever) or `keel queue:work --once`
(drain what's due and exit — the right shape for a cron trigger or a scheduled
task). Several workers can share the table: a job is claimed with an atomic
conditional update, so exactly one gets it, and a claim held past `staleAfter`
seconds (default 300) is released — the escape hatch for a worker that died
mid-job.

Two constraints follow from jobs being rows:

- **Only `Job` subclasses can be dispatched** — a closure can't be serialized,
  and the driver says so rather than storing something it can't run. A job's
  payload is its constructor state (its own enumerable properties), rebuilt on
  the worker via `registerJobs()` — which is why registration must happen in the
  worker process too.
- **A per-dispatch `backoff` override can't cross the process boundary** (a
  function isn't data). Backoff comes from the job class; `maxRetries`
  overrides are stored and honored.

Failed jobs land in the `failed_jobs` table, where the console can see them:

```bash
keel queue:failed        # list them
keel queue:retry 42      # back on the queue (keel queue:retry all for every one)
keel queue:flush         # delete them (or one: keel queue:flush 42)
```

[Keel Watch](./watch.md) shows the same list under **Failed jobs**, with retry
and delete buttons.

Options: `new DatabaseDriver({ table, failedTable, connection, staleAfter })` —
all optional; the defaults are `jobs`, `failed_jobs`, the default connection,
and 300 seconds.

## The redis driver

The same durability contract as the database driver — jobs survive a restart,
several workers share the backlog, exhausted jobs are retryable — with Redis's
latency instead of a SQL round-trip. No migration; just a client:

```ts
import { setQueue, RedisDriver, registerJobs, setRedis } from "@shaferllc/keel/core";

setRedis(myAdapter);            // ioredis, node-redis, Upstash… (see the redis guide)
registerJobs(SendWelcome);      // in BOTH the web process and the worker
setQueue(new RedisDriver());    // or new RedisDriver({ client, prefix, staleAfter })
```

How it's laid out: pending jobs live in a sorted set (`queue:jobs`) scored by
when they become due — delays and backoffs are just future scores. A claim is
`ZREM`: atomic per command, so exactly one worker removes any member, and no
Lua script is required — which keeps HTTP adapters like Upstash in play. A
claimed job sits in `queue:reserved` scored by its deadline; a worker that dies
mid-job leaves a member behind, and the next drain re-queues anything past
`staleAfter` (default 300 seconds). Failures land in the `queue:failed` hash,
so `queue:failed` / `queue:retry` / `queue:flush` and the Watch panel work
exactly as they do for the database driver.

The driver needs eight commands beyond the basic `RedisConnection` set —
`zadd`, `zrangebyscore`, `zrem`, `zcard`, `hset`, `hget`, `hgetall`, `hdel` —
each a passthrough to one standard Redis command. The built-in `MemoryRedis`
implements them (so tests run against the real driver); a custom adapter that
lacks any of them is refused at first use with the missing ones named.

The serialization rules are the database driver's: **`Job` subclasses only**
(a closure can't cross a process boundary), classes rebuilt via
`registerJobs()`, class-level backoff, stored `maxRetries` overrides.

**Which one?** Same durability, different trade: the database driver needs no
extra infrastructure and joins your existing backups and transactions; the
redis driver keeps queue chatter off your database and polls cheaper under
load. If you already run Redis for cache or rate limiting, the queue can share
it — the keys are prefixed.

## Running queued jobs

When a driver defers work, drain it with `work()`:

```ts
import { dispatch, work } from "@shaferllc/keel/core";

setQueue(new MemoryDriver());
await dispatch(new SendWelcome("a@x.com"));
await dispatch(new SendWelcome("b@x.com"));

const ran = await work(); // runs both; returns 2
```

`work()` is a no-op (returns `0`) for immediate drivers like `SyncDriver` — it
only drains drivers that hold jobs locally (those implementing `Drainable`).

Jobs run one at a time, highest priority first and otherwise in dispatch order.
`work()` drains what's **due**: a job still waiting out a `delay` or a retry
backoff is left on the queue for a later drain, so a second `work()` isn't
necessarily a no-op.

A job that throws is **retried** and, once it runs out of retries, **failed** —
`work()` records it and keeps going rather than propagating the error. See
[Retries and backoff](#retries-and-backoff) and
[When a job finally fails](#when-a-job-finally-fails).

## A custom / edge driver

A driver is one method — `push`. That's the seam for a real broker. On
Cloudflare, forward to a Queue binding and reconstruct the job in the consumer:

```ts
import type { QueueDriver } from "@shaferllc/keel/core";

const cloudflareQueue = (binding: Queue): QueueDriver => ({
  async push(job, options) {
    await binding.send({ job: serialize(job), options });
  },
});
setQueue(cloudflareQueue(env.MY_QUEUE));
// In the queue consumer, rebuild the job from the payload and call handle().
```

(`Queue` and `env` above are Cloudflare's binding types — illustrative, not Keel
exports.) The only method Keel requires is `push(job, options)`; return a promise
that resolves once the job is safely handed off. Because a `Dispatchable` can be a
class instance or a closure, a broker driver has to decide how to serialize it —
typically dispatch only plain-data jobs across the wire and reconstruct them in
the consumer.

Drivers that hold jobs locally can implement the `Drainable` interface
(`size` + `work()`) so `Queue.work()` can drive them — that's how `MemoryDriver`
works.

## Retries and backoff

Background work fails for boring reasons — a provider hiccups, a connection
drops. A job **retries** before it gives up, with a growing delay between
attempts. Declare the policy on the job class:

```ts
class ChargeCard extends Job {
  static maxRetries = 5;
  static backoff = exponentialBackoff(1_000); // 1s, 2s, 4s, 8s, 16s

  async handle() {
    await stripe.charge(this.amount);
  }
}
```

`maxRetries` defaults to **0** — a job that doesn't opt in fails on its first
throw, which is the safe default for work that isn't idempotent. The strategies:

| Backoff | Delays |
|---------|--------|
| `exponentialBackoff(baseMs?, maxMs?)` | 1s, 2s, 4s, 8s… (the default) |
| `linearBackoff(stepMs?, maxMs?)` | 5s, 10s, 15s… |
| `fixedBackoff(delayMs?)` | the same delay every time |
| `noBackoff` | retry immediately |

Both cap at `maxMs` (default 60s) so a long-lived job can't back off into next
week. Per-dispatch overrides win over the class:

```ts
await dispatch(new ChargeCard(id), { maxRetries: 1, backoff: noBackoff });
```

**A retry's delay is honored, not slept through.** `work()` drains what's *due*;
a job waiting out its backoff stays on the queue for a later drain. The
`SyncDriver` is the exception — it runs inline, so it retries immediately and
ignores the delay, because blocking a request for a 30-second backoff would be
worse than useless.

## When a job finally fails

Once the retries are exhausted the job is **failed**. Three things happen, in
order:

1. It's **logged** at `error` level, with the job name, id, and attempt count.
2. Its `failed(error)` hook runs — the last chance to alert or compensate.
3. It lands in the driver's **dead-letter list** (`driver.failed`) rather than
   vanishing.

```ts
class ChargeCard extends Job {
  static maxRetries = 3;

  async handle() { … }

  async failed(error: unknown) {
    await notifyBilling(this.orderId, error);
  }
}
```

**A failed job does not take down the worker.** `work()` records it and carries on
with the rest of the queue — one bad job can't stop the others. That's why the
failure is logged loudly: a worker that keeps running past a failure must not do
so silently.

```ts
await work();

for (const failure of getQueue().failed) {
  console.error(failure.id, failure.attempts, failure.error);
}
```

A throw inside `failed()` is logged and swallowed too — failing to handle a
failure must not itself crash the worker.

The `SyncDriver` is again the exception: it ran the job *inline*, so the caller is
right there and gets the error thrown at them.

## Priority

Lower numbers run first. Default is `0`, so a negative priority jumps the queue:

```ts
await dispatch(new SendReceipt(id), { priority: -10 }); // ahead of normal work
await dispatch(new RebuildSearchIndex(), { priority: 10 }); // whenever
```

A job class can declare its own default lane and priority:

```ts
class ChargeCard extends Job {
  static queue = "billing";
  static priority = -5;
}
```

## What a job knows about itself

While `handle()` runs, `this.context` carries the job's id, which attempt this is,
and the lane it's on — useful for logging, and for making a retry behave
differently from a first run:

```ts
class ImportFile extends Job {
  static maxRetries = 3;

  async handle() {
    const { jobId, attempt, queue } = this.context!;
    if (attempt > 1) logger().warn("retrying import", { jobId, attempt });
  }
}
```

## In tests

`fakeQueue()` records dispatches **without running them**, so a test can assert a
job was queued without paying for it to run — no email sent, no card charged.
`restoreQueue()` puts the real queue back.

```ts
import { fakeQueue, restoreQueue } from "@shaferllc/keel/core";

const queue = fakeQueue();

await registerUser(); // internally dispatches SendWelcome

queue.assertPushed(SendWelcome);
queue.assertPushed(SendWelcome, (job) => job.userId === user.id); // with a predicate
queue.assertPushedCount(1, SendWelcome);
queue.assertNotPushed(ChargeCard);
queue.assertNothingPushed();

restoreQueue();
```

`queue.pushedJobs(SendWelcome)` returns the queued entries, so you can assert on a
dispatch's `delay`, `queue`, or `priority`.

When you want the job to actually *run*, use the `MemoryDriver` instead and drain
it:

```ts
const driver = new MemoryDriver();
setQueue(driver);

await registerUser();

assert.equal(driver.size, 1);
await work(); // now run it and assert on the side effects
assert.equal(driver.failed.length, 0);
```

---

## API reference

### Top-level functions

The module keeps one process-wide default `Queue`. These four functions are the
everyday surface — you rarely touch `Queue` or a driver directly.

#### `dispatch(job, options?)`

`dispatch(job: Dispatchable, options?: JobOptions): Promise<void>`

Places a job (a `Job` instance or a plain function) on the default queue.

```ts
await dispatch(new SendWelcome("a@x.com"));
await dispatch(() => rebuildSearchIndex(), { delay: 60, queue: "emails" });
```

**Notes:** delegates to `getQueue().dispatch`. With the default `SyncDriver` the
returned promise resolves *after* the job has run, and a throwing job rejects it.
`options` defaults to `{}`; `delay`/`queue` are honored only by drivers that
support them.

#### `work()`

`work(): Promise<number>`

Drains the default queue's pending jobs and resolves with how many ran.

```ts
const ran = await work();
```

**Notes:** returns `0` for drivers that don't hold jobs locally (e.g.
`SyncDriver`). Runs jobs FIFO; a throwing job propagates and halts the drain.

#### `setQueue(driver)`

`setQueue(driver: QueueDriver): Queue`

Replaces the default queue with a new `Queue` wrapping `driver`, and returns it.

```ts
setQueue(new MemoryDriver());
const q = setQueue(new SyncDriver()); // returns the new Queue
```

**Notes:** global — the last call wins, and it rebinds what `dispatch`/`work`/
`getQueue` operate on. Before the first `setQueue`, the default is a `SyncDriver`.

#### `getQueue()`

`getQueue(): Queue`

Returns the current default `Queue` instance.

```ts
const driver = getQueue().driver; // inspect the active driver
```

**Notes:** the instance changes identity after each `setQueue` call.

### `Job`

`abstract class Job`

The base class for a unit of background work. Subclass it, pass data through the
constructor, and implement `handle()`.

```ts
class SendWelcome extends Job {
  constructor(private email: string) { super(); }
  async handle() { await mail().to(this.email).subject("Hi").text("Welcome").send(); }
}
```

**Notes:** dispatching a non-`Job` function is also allowed (see `Dispatchable`) —
`Job` exists for jobs that carry state or that you want to assert on by type in
tests (`job instanceof SendWelcome`).

#### `handle()`

`abstract handle(): void | Promise<void>`

The work the job performs. Called once when the driver runs the job.

```ts
async handle() { await rebuildSearchIndex(); }
```

**Notes:** may be sync or async — the runner wraps the result in
`Promise.resolve`, so either is awaited. Throwing surfaces the error to whoever
drains the queue.

### `Queue`

`class Queue`

Pairs a `QueueDriver` with the `dispatch`/`work` API. The module manages a default
instance for you; construct one yourself only if you want a second, independent
queue.

```ts
const q = new Queue(new MemoryDriver());
await q.dispatch(new SendWelcome("a@x.com"));
await q.work();
```

#### `new Queue(driver)`

`constructor(driver: QueueDriver)`

Wraps a driver. The driver is exposed as the readonly `driver` property.

```ts
const q = new Queue(new SyncDriver());
q.driver; // the SyncDriver you passed
```

#### `dispatch(job, options?)`

`dispatch(job: Dispatchable, options?: JobOptions): Promise<void>`

Hands the job to the driver's `push`. The driver decides when it runs.

```ts
await q.dispatch(new SendWelcome("a@x.com"), { queue: "emails" });
```

**Notes:** `options` defaults to `{}`. Resolves when `push` resolves.

#### `work()`

`work(): Promise<number>`

Drains the driver if it holds jobs locally, returning how many ran.

```ts
const ran = await q.work();
```

**Notes:** feature-detects `Drainable` — if the driver has no `work` method, this
returns `0` without touching it. That's why the same call is safe against any
driver.

#### `driver`

`readonly driver: QueueDriver`

The driver this queue wraps. Useful for inspection (e.g. casting to
`MemoryDriver` to read `.jobs` in a test).

### Drivers

Both built-in drivers implement `QueueDriver`. You register one with `setQueue`;
you don't usually call their methods directly.

#### `SyncDriver`

`class SyncDriver implements QueueDriver`

Runs each job the instant it's pushed. The default driver — ideal for dev and
tests where you want failures to surface immediately.

```ts
setQueue(new SyncDriver());
```

##### `push(job, options)`

`push(job: Dispatchable, options: JobOptions): Promise<void>`

Runs the job right away and resolves when it finishes.

```ts
await new SyncDriver().push(() => doWork(), {});
```

**Notes:** ignores `options` entirely (no deferral). A throwing job rejects the
promise. It is *not* `Drainable`, so `work()` against it returns `0`.

#### `MemoryDriver`

`class MemoryDriver implements QueueDriver, Drainable`

Holds pushed jobs in an in-memory array until you `work()` them. The go-to driver
for tests: dispatch, assert on `.jobs`/`.size`, then drain.

```ts
const driver = new MemoryDriver();
setQueue(driver);
await dispatch(new SendWelcome("a@x.com"));
driver.size;               // 1
driver.jobs[0].job;        // the queued Dispatchable
await work();              // runs it; size back to 0
```

##### `push(job, options)`

`push(job: Dispatchable, options: JobOptions): Promise<void>`

Appends `{ job, options }` to `.jobs` without running anything.

```ts
await driver.push(() => doWork(), { queue: "default" });
```

##### `work()`

`work(): Promise<number>`

Runs every pending job in FIFO order and returns how many ran.

```ts
const ran = await driver.work();
```

**Notes:** removes each job before running it, so a throwing job halts the drain
and is not retried. After a successful drain `.jobs` is empty and a repeat call
returns `0`.

##### `size`

`get size(): number`

The number of jobs currently waiting — `this.jobs.length`.

##### `jobs`

`readonly jobs: QueuedJob[]`

The live backlog of `{ job, options }` entries, in insertion order. Read it in
tests to assert what was queued and with which options.

### Interfaces & types

#### `Dispatchable`

`type Dispatchable = Job | (() => void | Promise<void>)`

What `dispatch`/`push` accept: a `Job` subclass instance or a zero-arg function.
Use a function for quick one-offs, a `Job` when the work carries data or you want
to identify it by type.

```ts
const a: Dispatchable = new SendWelcome("a@x.com");
const b: Dispatchable = () => rebuildSearchIndex();
```

#### `JobOptions`

```ts
interface JobOptions {
  delay?: number;  // seconds before the job becomes available
  queue?: string;  // named lane to place the job on
}
```

Per-dispatch hints. Both are optional and advisory — the built-in drivers ignore
them; a broker driver interprets them.

#### `QueueDriver`

```ts
interface QueueDriver {
  push(job: Dispatchable, options: JobOptions): Promise<void>;
}
```

The seam to your backend — implement it to target any broker. `push` is the only
required method: accept the job and resolve once it's safely handed off.

```ts
const logDriver: QueueDriver = {
  async push(job, options) {
    console.log("queued", options.queue ?? "default");
    // forward `job` to your broker here
  },
};
setQueue(logDriver);
```

#### `Drainable`

```ts
interface Drainable {
  readonly size: number;
  work(): Promise<number>;
}
```

Implement this *in addition to* `QueueDriver` when your driver holds jobs locally
and can run them on demand — that's what lets `Queue.work()` drive it. Feature
detection is by the presence of `work`, so a driver that omits `Drainable` is
simply never drained.

```ts
class ArrayDriver implements QueueDriver, Drainable {
  private q: Dispatchable[] = [];
  get size() { return this.q.length; }
  async push(job: Dispatchable) { this.q.push(job); }
  async work() {
    let n = 0;
    for (const job of this.q.splice(0)) { await (job instanceof Job ? job.handle() : job()); n++; }
    return n;
  }
}
```

#### `QueuedJob`

```ts
interface QueuedJob {
  job: Dispatchable;
  options: JobOptions;
}
```

An entry in `MemoryDriver.jobs`: the dispatched job paired with the options it was
dispatched with. What you assert on in tests.

```ts
const entry: QueuedJob = driver.jobs[0];
entry.options.queue; // string | undefined
```

### Retries & backoff

#### `Job.maxRetries`

`static maxRetries: number` — retries after the first failure. Default `0`.

#### `Job.backoff`

`static backoff: Backoff` — how long to wait before each retry. Default
`exponentialBackoff(1_000)`.

#### `Job.failed(error)`

`failed(error: unknown): void | Promise<void>` — runs once the retries are
exhausted. A throw in here is logged and swallowed.

#### `Job.context`

`context?: JobContext` — `{ jobId, attempt, queue }`, set by the driver before
`handle()` runs. `attempt` is 1 on the first run.

#### Backoff strategies

| Function | Signature |
|----------|-----------|
| `exponentialBackoff` | `(baseMs = 1000, maxMs = 60000) => Backoff` — 1s, 2s, 4s… |
| `linearBackoff` | `(stepMs = 1000, maxMs = 60000) => Backoff` — 1s, 2s, 3s… |
| `fixedBackoff` | `(delayMs = 1000) => Backoff` |
| `noBackoff` | `Backoff` — retry immediately |

`type Backoff = (attempt: number) => number` — milliseconds before `attempt`
(1 = the first retry).

### Testing

#### `fakeQueue()` / `restoreQueue()`

`fakeQueue(): FakeQueue` swaps the queue for one that records dispatches without
running them. `restoreQueue()` puts the real one back.

`FakeQueue`:

| Method | Signature |
|--------|-----------|
| `assertPushed` | `(type, where?) => void` |
| `assertNotPushed` | `(type, where?) => void` |
| `assertPushedCount` | `(count, type?) => void` |
| `assertNothingPushed` | `() => void` |
| `pushedJobs` | `(type) => QueuedJob[]` — to assert on delay/lane/priority |

### Interfaces & types

#### `JobOptions`

`{ delay?, queue?, priority?, maxRetries?, backoff? }` — `delay` in seconds;
`priority` lower runs first; `maxRetries`/`backoff` override the job class.

#### `JobContext`

`{ jobId: string; attempt: number; queue: string }`.

#### `QueuedJob`

`{ id, job, options, attempts, availableAt }` — a job sitting on a queue.
`availableAt` is the epoch-ms before which it must not run (delay or backoff).

#### `FailedJob`

`{ id, job, options, attempts, error }` — a job that exhausted its retries. Read
them from `driver.failed` or `getQueue().failed`.

### The database driver

#### `DatabaseDriver`

`class DatabaseDriver implements QueueDriver, FailedJobStore`

Jobs as rows; see [The database driver](#the-database-driver) above.
`new DatabaseDriver(options?: DatabaseDriverOptions)` with
`{ table?, failedTable?, connection?, staleAfter? }`.

| Method | Signature |
|--------|-----------|
| `push` | `(job, options) => Promise<void>` — inserts a row; refuses closures |
| `work` | `() => Promise<number>` — releases stale claims, then runs every due job |
| `pending` | `() => Promise<number>` — waiting (unreserved) jobs |
| `failedJobs` | `() => Promise<FailedJobRecord[]>` |
| `retryFailed` | `(id) => Promise<boolean>` — move a failed job back onto the queue |
| `flushFailed` | `(id?) => Promise<number>` — delete one failed job, or all of them |

#### `registerJobs(...classes)`

`registerJobs(...classes: JobClass[]): void`

Registers job classes by name so a worker can rebuild them from their stored
payload. Call at boot in every process that runs `queue:work`.

#### `queueMigration(table?, failedTable?)`

`queueMigration(table = "jobs", failedTable = "failed_jobs"): Migration`

The schema for the driver's two tables — add it to your migrations.

#### `RedisDriver`

`class RedisDriver implements QueueDriver, FailedJobStore`

Jobs in Redis; see [The redis driver](#the-redis-driver) above.
`new RedisDriver(options?: RedisDriverOptions)` with
`{ client?, prefix?, staleAfter? }` — defaults: the `redis()` global, `"queue"`,
300 seconds. Same method surface as `DatabaseDriver` (`push` / `work` /
`pending` / `failedJobs` / `retryFailed` / `flushFailed`).

#### `FailedJobRecord` / `FailedJobStore`

`FailedJobRecord` is `{ id, queue, job, payload, attempts, error, failedAt }` —
`job` is the class name, `failedAt` epoch ms. `FailedJobStore` is the interface
(`failedJobs` / `retryFailed` / `flushFailed`) the console's `queue:failed`,
`queue:retry`, and `queue:flush` commands drive; implement it on a custom driver
to get those commands (and the Watch panel's buttons) for free.
