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

`work()` is a no-op (returns `0`) for immediate drivers like `SyncDriver`.

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
