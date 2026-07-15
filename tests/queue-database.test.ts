import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  setConnection,
  clearConnections,
  getConnection,
  db,
  type Connection,
  type Row,
} from "../src/core/database.js";
import { Migrator } from "../src/core/migrations.js";
import {
  Job,
  Queue,
  DatabaseDriver,
  registerJobs,
  queueMigration,
  noBackoff,
  fixedBackoff,
} from "../src/core/queue.js";

/** A real in-memory SQLite Connection so the driver exercises actual SQL. */
function sqliteConnection(): Connection {
  const sdb = new DatabaseSync(":memory:");
  return {
    async select(sql, bindings) {
      return sdb.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = sdb.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
}

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
  failedWith: unknown;

  async handle(): Promise<void> {
    if ((this.context?.attempt ?? 1) < Flaky.succeedOnAttempt) throw new Error("flaked");
    ran.push("flaky ok");
  }
  override async failed(error: unknown): Promise<void> {
    this.failedWith = error;
  }
}

class Slow extends Job {
  static override backoff = fixedBackoff(60_000);
  static override maxRetries = 3;
  async handle(): Promise<void> {
    throw new Error("always slow");
  }
}

async function freshDriver(): Promise<DatabaseDriver> {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");
  const { connection, dialect } = getConnection();
  await new Migrator(connection, dialect).up([queueMigration()]);
  return new DatabaseDriver();
}

beforeEach(() => {
  ran.length = 0;
  registerJobs(Greet, Flaky, Slow);
});

test("database driver: dispatch persists a row, work() runs and removes it", async () => {
  const queue = new Queue(await freshDriver());

  await queue.dispatch(new Greet("Ada"));
  assert.equal(await db("jobs").count(), 1);
  assert.deepEqual(ran, []); // persisted, not executed

  assert.equal(await queue.work(), 1);
  assert.deepEqual(ran, ["hello Ada"]);
  assert.equal(await db("jobs").count(), 0);
});

test("database driver: payload survives the round trip (constructor state)", async () => {
  const driver = await freshDriver();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("Grace"));
  const row = await db("jobs").first();
  assert.equal(row!.job, "Greet");
  assert.deepEqual(JSON.parse(String(row!.payload)), { name: "Grace" });

  await queue.work();
  assert.deepEqual(ran, ["hello Grace"]);
});

test("database driver: a closure is refused with a pointed error", async () => {
  const queue = new Queue(await freshDriver());
  await assert.rejects(
    () => queue.dispatch(() => {}),
    /can't serialize a closure/,
  );
});

test("database driver: retries with backoff, then lands in failed_jobs", async () => {
  const driver = await freshDriver();
  const queue = new Queue(driver);
  Flaky.succeedOnAttempt = Infinity;

  await queue.dispatch(new Flaky());
  await queue.work(); // attempt 1 fails; noBackoff → immediately due again
  // attempt 1 requeued within the same work() loop and retried (attempt 2),
  // which exhausts maxRetries = 1 → failed table.
  assert.equal(await db("jobs").count(), 0);

  const failed = await driver.failedJobs();
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.job, "Flaky");
  assert.equal(failed[0]!.attempts, 2);
  assert.match(failed[0]!.error, /flaked/);
});

test("database driver: backoff keeps a retry out of reach until it elapses", async () => {
  const driver = await freshDriver();
  const queue = new Queue(driver);

  await queue.dispatch(new Slow());
  assert.equal(await queue.work(), 1); // attempt 1 ran (and failed)

  // The retry is scheduled a minute out — nothing is due now.
  assert.equal(await queue.work(), 0);
  const row = await db("jobs").first();
  assert.equal(Number(row!.attempts), 1);
  assert.ok(Number(row!.available_at) > Date.now() + 30_000);
});

test("database driver: retryFailed moves a job back and it can succeed", async () => {
  const driver = await freshDriver();
  const queue = new Queue(driver);
  Flaky.succeedOnAttempt = Infinity;

  await queue.dispatch(new Flaky());
  await queue.work();
  const [failed] = await driver.failedJobs();
  assert.ok(failed);

  Flaky.succeedOnAttempt = 1; // "deploy the fix"
  assert.equal(await driver.retryFailed(failed.id), true);
  assert.equal((await driver.failedJobs()).length, 0);

  await queue.work();
  assert.deepEqual(ran, ["flaky ok"]);
});

test("database driver: flushFailed clears one or all", async () => {
  const driver = await freshDriver();
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

test("database driver: an unregistered job class fails instead of crashing the worker", async () => {
  const driver = await freshDriver();

  // Simulate a row dispatched by a process that knew a class this one doesn't.
  await db("jobs").insert({
    queue: "default",
    job: "Forgotten",
    payload: "{}",
    attempts: 0,
    max_retries: null,
    priority: 0,
    available_at: Date.now(),
    reserved_at: null,
    created_at: Date.now(),
  });

  await driver.work();
  assert.equal(await db("jobs").count(), 0);
  const failed = await driver.failedJobs();
  assert.equal(failed.length, 1);
  assert.match(failed[0]!.error, /registerJobs\(Forgotten\)/);
});

test("database driver: delayed jobs wait; priority orders due ones", async () => {
  const driver = await freshDriver();
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("later"), { delay: 60 });
  await queue.dispatch(new Greet("low"), { priority: 10 });
  await queue.dispatch(new Greet("high"), { priority: -10 });

  assert.equal(await queue.work(), 2);
  assert.deepEqual(ran, ["hello high", "hello low"]);
  assert.equal(await driver.pending(), 1); // the delayed one is still waiting
});

test("database driver: a stale reservation is released and retried", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");
  const { connection, dialect } = getConnection();
  await new Migrator(connection, dialect).up([queueMigration()]);
  const driver = new DatabaseDriver({ staleAfter: 1 });
  const queue = new Queue(driver);

  await queue.dispatch(new Greet("survivor"));
  // A worker claimed it two seconds ago and died.
  await db("jobs").update({ reserved_at: Date.now() - 2_000 });

  assert.equal(await queue.work(), 1);
  assert.deepEqual(ran, ["hello survivor"]);
});
