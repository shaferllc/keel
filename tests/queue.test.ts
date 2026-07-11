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
  assert.deepEqual(driver.jobs[0]!.options, { delay: 60, queue: "emails" });
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

test("errors during work() surface from the worker", async () => {
  const driver = new MemoryDriver();
  setQueue(driver);
  await dispatch(() => {
    throw new Error("in worker");
  });
  await assert.rejects(() => work(), /in worker/);
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
