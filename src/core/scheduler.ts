/**
 * Task scheduling — declare recurring work with a fluent cadence, then let a
 * cron trigger drive it. Like Laravel's scheduler, but edge-first: you run the
 * scheduler from a single per-minute trigger (Cloudflare Cron Triggers, or a
 * Node interval), and it runs whatever's due.
 *
 *   schedule(new PruneSessions()).daily();
 *   schedule(() => syncInventory()).everyFiveMinutes();
 *   schedule(new SendDigest()).cron("0 9 * * 1");   // 9am Mondays
 *
 *   // from a Cloudflare `scheduled()` handler (or a Node setInterval):
 *   await scheduler().runDue(new Date(event.scheduledTime));
 *
 * A task is a `Job` or a plain function. `runDue(now)` runs every task whose
 * cron expression matches `now` (to the minute).
 */

import { Job, type Dispatchable } from "./queue.js";

function runTask(job: Dispatchable): Promise<void> {
  return Promise.resolve(job instanceof Job ? job.handle() : job());
}

/* -------------------------------- cron ------------------------------------ */

/** Match one cron field (`*`, `5`, `1,2`, `1-5`, `*​/5`, `0-30/10`) against a value. */
function fieldMatches(spec: string, value: number, min: number, max: number): boolean {
  if (spec === "*") return true;
  for (const part of spec.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let lo: number;
    let hi: number;
    if (range === "*" || range === undefined) {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = stepStr ? max : lo; // "5/10" means 5, 15, 25, … up to max
    }
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
  }
  return false;
}

/** Whether a 5-field cron expression matches `date` (to the minute, in the Date's own fields). */
export function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expression}" (need 5 fields)`);
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  const minuteOk = fieldMatches(min, date.getMinutes(), 0, 59);
  const hourOk = fieldMatches(hour, date.getHours(), 0, 23);
  const monthOk = fieldMatches(mon, date.getMonth() + 1, 1, 12);
  const domOk = fieldMatches(dom, date.getDate(), 1, 31);
  const dowOk = fieldMatches(dow, date.getDay(), 0, 6);

  // Standard (Vixie) cron: when both day-of-month and day-of-week are restricted,
  // the day matches if *either* does; otherwise both must match.
  const dayOk = dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk;
  return minuteOk && hourOk && monthOk && dayOk;
}

/* ----------------------------- scheduled task ----------------------------- */

export class ScheduledTask {
  expression = "* * * * *";
  name?: string;

  constructor(readonly job: Dispatchable) {}

  /** Set a raw cron expression. */
  cron(expression: string): this {
    this.expression = expression;
    return this;
  }
  /** Label the task (for logging / introspection). */
  named(name: string): this {
    this.name = name;
    return this;
  }

  everyMinute(): this {
    return this.cron("* * * * *");
  }
  everyFiveMinutes(): this {
    return this.cron("*/5 * * * *");
  }
  everyTenMinutes(): this {
    return this.cron("*/10 * * * *");
  }
  everyFifteenMinutes(): this {
    return this.cron("*/15 * * * *");
  }
  everyThirtyMinutes(): this {
    return this.cron("*/30 * * * *");
  }
  hourly(): this {
    return this.cron("0 * * * *");
  }
  /** At `minute` past every hour. */
  hourlyAt(minute: number): this {
    return this.cron(`${minute} * * * *`);
  }
  daily(): this {
    return this.cron("0 0 * * *");
  }
  /** Once a day at `HH:MM`. */
  dailyAt(time: string): this {
    const [h, m] = time.split(":");
    return this.cron(`${Number(m)} ${Number(h)} * * *`);
  }
  /** Weekly on `weekday` (0 = Sunday) at midnight. */
  weekly(weekday = 0): this {
    return this.cron(`0 0 * * ${weekday}`);
  }
  /** Monthly on `day` at midnight. */
  monthly(day = 1): this {
    return this.cron(`0 0 ${day} * *`);
  }

  isDue(now: Date): boolean {
    return cronMatches(this.expression, now);
  }
}

/* ------------------------------- scheduler -------------------------------- */

export class Scheduler {
  readonly tasks: ScheduledTask[] = [];

  /** Register a task and return it for cadence configuration. */
  schedule(job: Dispatchable): ScheduledTask {
    const task = new ScheduledTask(job);
    this.tasks.push(task);
    return task;
  }

  /** The tasks due at `now`. */
  due(now: Date = new Date()): ScheduledTask[] {
    return this.tasks.filter((t) => t.isDue(now));
  }

  /** Run every task due at `now` (in registration order); returns how many ran. */
  async runDue(now: Date = new Date()): Promise<number> {
    let count = 0;
    for (const task of this.tasks) {
      if (task.isDue(now)) {
        await runTask(task.job);
        count++;
      }
    }
    return count;
  }
}

/* -------------------------------- global ---------------------------------- */

let instance = new Scheduler();

/** The default scheduler. */
export function scheduler(): Scheduler {
  return instance;
}

/** Replace the default scheduler (e.g. to reset between tests). */
export function setScheduler(next: Scheduler): Scheduler {
  instance = next;
  return instance;
}

/** Schedule a task on the default scheduler. */
export function schedule(job: Dispatchable): ScheduledTask {
  return instance.schedule(job);
}
