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
soon as it's enqueued). Both `delay` and `queue` are advisory — `SyncDriver` and
`MemoryDriver` ignore them; a real broker driver is where they take effect.

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

With the sync driver, a job that throws surfaces the error to whoever called
`dispatch` — so failures are visible in development.

## Running queued jobs

When a driver defers work, drain it with `work()`:

```ts
import { dispatch, work } from "@shaferllc/keel/core";

setQueue(new MemoryDriver());
await dispatch(new SendWelcome("a@x.com"));
await dispatch(new SendWelcome("b@x.com"));

const ran = await work(); // runs both in FIFO order; returns 2
```

`work()` is a no-op (returns `0`) for immediate drivers like `SyncDriver` — it
only drains drivers that hold jobs locally (those implementing `Drainable`).
`MemoryDriver.work()` empties the queue as it goes, so a second `work()` with
nothing new dispatched returns `0`.

Jobs run one at a time, in the order dispatched. If a job throws, `work()`
propagates the error and stops — the jobs that already ran stay done, and the one
that threw has been `shift`ed off, so it won't be retried on the next `work()`.
Wrap `handle()` in your own try/catch if you need per-job error isolation or
retries; the core keeps the loop deliberately simple.

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

## In tests

Use the `MemoryDriver` to assert a job was queued without running it, then drain:

```ts
import { setQueue, MemoryDriver, dispatch, work } from "@shaferllc/keel/core";

const driver = new MemoryDriver();
setQueue(driver);

await registerUser(); // internally dispatches SendWelcome

assert.equal(driver.size, 1);
assert.ok(driver.jobs[0].job instanceof SendWelcome);

await work(); // now run it and assert on the side effects
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
