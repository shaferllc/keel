import { ServiceProvider, schedule } from "@shaferllc/keel/core";

import { PruneExpiredInvitationsJob } from "../Jobs/PruneExpiredInvitationsJob.js";

/**
 * The app's recurring work, declared in code rather than in a crontab.
 *
 * This provider only registers cadences — it runs nothing. Something has to tick the
 * scheduler, and which something depends on the runtime:
 *
 *   Node — the interval in BackgroundServiceProvider (Node provider list only).
 *   Edge — the Worker's `scheduled` handler, driven by the cron trigger in
 *          wrangler.jsonc. See worker.ts.
 *
 * Either way it is *one* trigger no matter how many tasks land here, because the
 * scheduler decides what's due. Adding work is a line in this file, never a new cron
 * entry — which is the whole reason to define schedules in code.
 *
 * This provider is in *both* provider lists: the Worker's `scheduled` handler needs
 * these declarations to know what is due.
 */
export class ScheduleServiceProvider extends ServiceProvider {
  boot(): void {
    schedule(new PruneExpiredInvitationsJob()).named("prune-invitations").dailyAt("03:15");
  }
}
