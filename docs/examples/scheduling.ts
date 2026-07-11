// Type-check harness for docs/scheduling.md. Compile-only — never executed.
import {
  schedule,
  scheduler,
  setScheduler,
  Scheduler,
  cronMatches,
  Job,
  logger,
} from "@shaferllc/keel/core";

class PruneSessions extends Job {
  async handle() {}
}
class SendDigest extends Job {
  async handle() {}
}
declare function syncInventory(): Promise<void>;
declare const job: Job;

export function scheduling() {
  schedule(new PruneSessions()).daily();
  schedule(() => syncInventory()).everyFiveMinutes();
  schedule(new SendDigest()).cron("0 9 * * 1");
}

export function cadences() {
  const t = schedule(job);
  t.everyMinute();
  t.everyTenMinutes();
  t.hourly();
  t.hourlyAt(15);
  t.daily();
  t.dailyAt("13:30");
  t.weekly(1);
  t.monthly(15);
  t.cron("*/10 9-17 * * 1-5");
}

// Cloudflare scheduled handler shape
type ScheduledEvent = { scheduledTime: number };
type ExecutionContext = { waitUntil(p: Promise<unknown>): void };
export const worker = {
  async scheduled(event: ScheduledEvent, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(scheduler().runDue(new Date(event.scheduledTime)));
  },
};

export function nodeInterval() {
  setInterval(() => scheduler().runDue(new Date()), 60_000);
}

export function inspecting() {
  schedule(job).named("prune-sessions").daily();
  for (const t of scheduler().due(new Date())) logger().info("due", { task: t.name });
}

export function fresh(): Scheduler {
  const s = setScheduler(new Scheduler());
  const match: boolean = cronMatches("*/5 * * * *", new Date());
  return match ? s : scheduler();
}
