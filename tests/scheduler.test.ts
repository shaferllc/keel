import { test } from "node:test";
import assert from "node:assert/strict";

import { Scheduler, schedule, setScheduler, cronMatches } from "../src/core/scheduler.js";
import { Job } from "../src/core/queue.js";

// A fixed date: Mon 2026-07-13, 09:05 local.
function at(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

test("cadence helpers set the right cron expression", () => {
  const s = new Scheduler();
  assert.equal(s.schedule(() => {}).everyMinute().expression, "* * * * *");
  assert.equal(s.schedule(() => {}).everyFiveMinutes().expression, "*/5 * * * *");
  assert.equal(s.schedule(() => {}).hourly().expression, "0 * * * *");
  assert.equal(s.schedule(() => {}).daily().expression, "0 0 * * *");
  assert.equal(s.schedule(() => {}).dailyAt("13:30").expression, "30 13 * * *");
  assert.equal(s.schedule(() => {}).weekly(1).expression, "0 0 * * 1");
  assert.equal(s.schedule(() => {}).monthly(15).expression, "0 0 15 * *");
});

test("cronMatches: wildcards, exact, ranges, lists, and steps", () => {
  const noon = at(2026, 7, 13, 12, 0);
  assert.equal(cronMatches("* * * * *", noon), true);
  assert.equal(cronMatches("0 12 * * *", noon), true);
  assert.equal(cronMatches("0 13 * * *", noon), false);
  assert.equal(cronMatches("*/15 * * * *", at(2026, 7, 13, 9, 15)), true);
  assert.equal(cronMatches("*/15 * * * *", at(2026, 7, 13, 9, 16)), false);
  assert.equal(cronMatches("0 9-17 * * *", at(2026, 7, 13, 14, 0)), true);
  assert.equal(cronMatches("0 9-17 * * *", at(2026, 7, 13, 18, 0)), false);
  assert.equal(cronMatches("0 0 1,15 * *", at(2026, 7, 15, 0, 0)), true);
  assert.equal(cronMatches("0 0 1,15 * *", at(2026, 7, 16, 0, 0)), false);
});

test("cronMatches: day-of-week (Monday = 1)", () => {
  assert.equal(cronMatches("0 9 * * 1", at(2026, 7, 13, 9, 0)), true); // Mon
  assert.equal(cronMatches("0 9 * * 1", at(2026, 7, 14, 9, 0)), false); // Tue
});

test("runDue runs exactly the due tasks and returns the count", async () => {
  const s = new Scheduler();
  const ran: string[] = [];
  s.schedule(() => ran.push("minutely")).everyMinute();
  s.schedule(() => ran.push("hourly")).hourly();
  s.schedule(() => ran.push("daily")).daily();

  // 09:05 → only everyMinute is due
  let count = await s.runDue(at(2026, 7, 13, 9, 5));
  assert.equal(count, 1);
  assert.deepEqual(ran, ["minutely"]);

  // 00:00 → minutely + hourly + daily all due
  ran.length = 0;
  count = await s.runDue(at(2026, 7, 13, 0, 0));
  assert.equal(count, 3);
  assert.deepEqual(ran.sort(), ["daily", "hourly", "minutely"]);
});

test("scheduled Jobs run via handle()", async () => {
  const s = new Scheduler();
  const log: string[] = [];
  class Prune extends Job {
    async handle() {
      log.push("pruned");
    }
  }
  s.schedule(new Prune()).everyMinute();
  await s.runDue(at(2026, 7, 13, 9, 0));
  assert.deepEqual(log, ["pruned"]);
});

test("due() lists without running", () => {
  const s = new Scheduler();
  s.schedule(() => {}).named("a").everyMinute();
  s.schedule(() => {}).named("b").daily();
  const due = s.due(at(2026, 7, 13, 9, 30));
  assert.deepEqual(due.map((t) => t.name), ["a"]);
});

test("global schedule() / scheduler() and cron() custom expressions", async () => {
  setScheduler(new Scheduler());
  let ran = false;
  schedule(() => {
    ran = true;
  }).cron("5 9 * * 1"); // 09:05 Mondays

  assert.equal((await import("../src/core/scheduler.js")).scheduler().tasks.length, 1);
  await (await import("../src/core/scheduler.js")).scheduler().runDue(at(2026, 7, 13, 9, 5));
  assert.equal(ran, true);
});

test("an invalid cron expression throws", () => {
  assert.throws(() => cronMatches("* * *", new Date()), /need 5 fields/);
});
