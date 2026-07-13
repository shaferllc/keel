import {
  MemoryDriver,
  ServiceProvider,
  getQueue,
  logger,
  scheduler,
  setQueue,
  work,
} from "@shaferllc/keel/core";

/**
 * The background worker — Node only, and deliberately absent from the edge list.
 *
 * A Worker may not keep a timer running between requests, so an in-memory queue there
 * would accept jobs that never ran. On Cloudflare the queue stays the default
 * `SyncDriver` (jobs run inline, on the request) and the cron trigger drives the
 * scheduler instead. When inline work gets too slow there, the answer is a Cloudflare
 * Queue binding behind a custom driver — one `push` method — not a timer.
 *
 * Under Node, two things happen on one interval:
 *
 *   1. The queue driver becomes `MemoryDriver`, so `dispatch()` returns immediately
 *      and the work happens on the next tick. That is the entire point of a queue: the
 *      person who clicked "Invite" doesn't wait on SMTP. (The framework default,
 *      `SyncDriver`, runs jobs inline — right for tests, but it would put the mail
 *      provider back on the request path.)
 *
 *   2. Due scheduled tasks run.
 *
 * One process, one timer, and honest about its limits: jobs live in memory, so a crash
 * loses the backlog. When that matters, swap the driver — the jobs themselves don't
 * change.
 */
const QUEUE_TICK_MS = 1_000;
const SCHEDULER_TICK_MS = 60_000;

export class BackgroundServiceProvider extends ServiceProvider {
  private queueTimer?: ReturnType<typeof setInterval>;
  private scheduleTimer?: ReturnType<typeof setInterval>;

  register(): void {
    setQueue(new MemoryDriver());
  }

  ready(): void {
    this.queueTimer = setInterval(() => void this.drain(), QUEUE_TICK_MS);
    this.scheduleTimer = setInterval(() => void this.runDue(), SCHEDULER_TICK_MS);

    // Don't hold the process open just for the timers: a console command that finishes
    // its work should exit, not hang waiting for the next tick.
    this.queueTimer.unref?.();
    this.scheduleTimer.unref?.();
  }

  /**
   * A failing job must not kill the timer. `work()` already records a failed job and
   * carries on with the rest of the queue; this catch is for the driver itself
   * throwing — if that escaped, the interval would die silently and the queue would
   * stop draining with nothing to say why.
   */
  private async drain(): Promise<void> {
    try {
      const ran = await work();
      if (ran > 0) {
        logger().debug("queue drained", { ran, failed: getQueue().failed.length });
      }
    } catch (error) {
      logger().error("queue drain threw", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runDue(): Promise<void> {
    try {
      await scheduler().runDue(new Date());
    } catch (error) {
      logger().error("scheduler tick threw", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  shutdown(): void {
    clearInterval(this.queueTimer);
    clearInterval(this.scheduleTimer);
  }
}
