// Type-check harness for docs/queues.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
// The Cloudflare "custom driver" snippet uses Cloudflare's own Queue/env types,
// which aren't Keel exports, so it stays illustrative in the doc and is omitted
// here.
import {
  Job,
  Queue,
  SyncDriver,
  MemoryDriver,
  dispatch,
  work,
  setQueue,
  getQueue,
  mail,
  type Dispatchable,
  type JobOptions,
  type QueueDriver,
  type Drainable,
  type QueuedJob,
} from "@shaferllc/keel/core";

declare const user: { email: string };
declare function rebuildSearchIndex(): Promise<void>;
declare function doWork(): Promise<void>;
declare function registerUser(): Promise<void>;

export class SendWelcome extends Job {
  constructor(private email: string) {
    super();
  }
  async handle() {
    await mail().to(this.email).subject("Welcome").text("Glad you're here").send();
  }
}

export async function dispatching() {
  await dispatch(new SendWelcome(user.email));
  await dispatch(new SendWelcome(user.email), { delay: 60, queue: "emails" });
  await dispatch(() => rebuildSearchIndex());
}

export function drivers() {
  setQueue(new SyncDriver());
  setQueue(new MemoryDriver());
}

export async function runningQueued() {
  setQueue(new MemoryDriver());
  await dispatch(new SendWelcome("a@x.com"));
  await dispatch(new SendWelcome("b@x.com"));
  const ran: number = await work();
  return ran;
}

export async function inTests() {
  const driver = new MemoryDriver();
  setQueue(driver);
  await registerUser();
  const size: number = driver.size;
  const first: boolean = driver.jobs[0]!.job instanceof SendWelcome;
  await work();
  return { size, first };
}

// --- API reference: top-level functions ---

export async function topLevel() {
  await dispatch(new SendWelcome("a@x.com"));
  await dispatch(() => rebuildSearchIndex(), { delay: 60, queue: "emails" });

  const ran: number = await work();

  setQueue(new MemoryDriver());
  const q: Queue = setQueue(new SyncDriver());

  const driver: QueueDriver = getQueue().driver;
  return { ran, q, driver };
}

// --- API reference: Job ---

export class RebuildIndex extends Job {
  async handle() {
    await rebuildSearchIndex();
  }
}

// --- API reference: Queue ---

export async function queueClass() {
  const q = new Queue(new MemoryDriver());
  await q.dispatch(new SendWelcome("a@x.com"));
  await q.dispatch(new SendWelcome("a@x.com"), { queue: "emails" });
  const ran: number = await q.work();
  const driver: QueueDriver = q.driver;
  return { ran, driver };
}

// --- API reference: drivers ---

export async function syncDriver() {
  const d = new SyncDriver();
  await d.push(() => doWork(), {});
}

export async function memoryDriver() {
  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(new SendWelcome("a@x.com"));
  const size: number = driver.size;
  const queued: Dispatchable = driver.jobs[0]!.job;
  await driver.push(() => doWork(), { queue: "default" });
  const ran: number = await driver.work();
  return { size, queued, ran };
}

// --- API reference: interfaces & types ---

export const a: Dispatchable = new SendWelcome("a@x.com");
export const b: Dispatchable = () => rebuildSearchIndex();

export const opts: JobOptions = { delay: 60, queue: "emails" };

export const logDriver: QueueDriver = {
  async push(job, options) {
    void job;
    console.log("queued", options.queue ?? "default");
  },
};

export function registerLogDriver() {
  setQueue(logDriver);
}

export class ArrayDriver implements QueueDriver, Drainable {
  private q: Dispatchable[] = [];
  get size() {
    return this.q.length;
  }
  async push(job: Dispatchable) {
    this.q.push(job);
  }
  async work() {
    let n = 0;
    for (const job of this.q.splice(0)) {
      await (job instanceof Job ? job.handle() : job());
      n++;
    }
    return n;
  }
}

export function queuedJobEntry(driver: MemoryDriver) {
  const entry: QueuedJob = driver.jobs[0]!;
  const lane: string | undefined = entry.options.queue;
  return lane;
}
