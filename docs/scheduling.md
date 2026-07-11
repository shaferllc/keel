# Task Scheduling

Declare recurring work with a fluent cadence, then let a **single cron trigger**
drive it — Laravel's scheduler, but edge-first. Instead of a crontab entry per
job, you register tasks in code and run the scheduler once a minute; it runs
whatever's due.

## Scheduling tasks

A task is a [`Job`](./queues.md) or a plain function. Register it, then set the
cadence:

```ts
import { schedule } from "@shaferllc/keel/core";

schedule(new PruneSessions()).daily();
schedule(() => syncInventory()).everyFiveMinutes();
schedule(new SendDigest()).cron("0 9 * * 1"); // 9am Mondays
```

### Cadences

```ts
task.everyMinute();
task.everyFiveMinutes();   // and Ten / Fifteen / Thirty
task.hourly();
task.hourlyAt(15);         // :15 past every hour
task.daily();
task.dailyAt("13:30");
task.weekly(1);            // Monday (0 = Sunday) at midnight
task.monthly(15);          // the 15th at midnight
task.cron("*/10 9-17 * * 1-5"); // any 5-field cron expression
```

## Running the scheduler

Run the scheduler once a minute from a cron trigger; `runDue(now)` runs every task
whose expression matches `now` (to the minute).

### Cloudflare (Cron Triggers)

Add a trigger to `wrangler.jsonc` (`"triggers": { "crons": ["* * * * *"] }`) and
call the scheduler from the Worker's `scheduled` handler:

```ts
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduler().runDue(new Date(event.scheduledTime)));
  },
};
```

### Node

```ts
setInterval(() => scheduler().runDue(new Date()), 60_000);
```

Because the scheduler decides what's due, you only ever wire **one** trigger, no
matter how many tasks you schedule.

## Inspecting

`scheduler().due(now)` returns the due tasks without running them, and every task
has an `expression` and optional `name`:

```ts
schedule(job).named("prune-sessions").daily();
for (const t of scheduler().due(new Date())) logger().info("due", { task: t.name });
```

## API reference

### `schedule(job)`

`schedule(job: Job | (() => void | Promise<void>)): ScheduledTask`

Registers a task on the default scheduler and returns it for cadence
configuration.

### `scheduler()` / `setScheduler(next)`

The default `Scheduler`; `setScheduler` replaces it (reset between tests).

### `ScheduledTask`

Returned by `schedule`. Cadence setters return `this` (chainable):
`everyMinute` / `everyFiveMinutes` / `everyTenMinutes` / `everyFifteenMinutes` /
`everyThirtyMinutes` / `hourly` / `hourlyAt(m)` / `daily` / `dailyAt("HH:MM")` /
`weekly(weekday?)` / `monthly(day?)` / `cron(expr)` / `named(name)`. `isDue(now)`
reports whether it matches a `Date`.

### `Scheduler`

| Method | Notes |
|--------|-------|
| `schedule(job)` | register a task |
| `due(now?)` | the tasks due at `now` (no run) |
| `runDue(now?)` | run every due task; returns the count |
| `tasks` | all registered tasks |

### `cronMatches(expression, date)`

`cronMatches(expression: string, date: Date): boolean`

Whether a 5-field cron expression (`min hour dom month dow`) matches `date` to the
minute. Supports `*`, exact values, lists (`1,15`), ranges (`9-17`), and steps
(`*/5`, `0-30/10`). Day-of-month and day-of-week follow standard cron: when both
are restricted, either matching counts. Fields use the `Date`'s own values (UTC in
a Worker, local under Node).
