/**
 * The Cloudflare Workers entry. `wrangler dev` / `wrangler deploy` use this.
 *
 * D1's binding only exists inside a request, so the connection is wired here, before
 * the app boots — and the app is built once, then reused.
 *
 * Note the provider list: `edgeProviders`, not the Node one. See providers.edge.ts.
 */

import { setConnection, HttpKernel, scheduler } from "@shaferllc/keel/core";
import type { Application } from "@shaferllc/keel/core";
import { d1Connection, type D1Like } from "@shaferllc/keel/db/d1";

import { createApplication } from "./bootstrap/app.js";
import { edgeProviders } from "./bootstrap/providers.edge.js";

interface Env {
  DB: D1Like;
}

interface ScheduledEvent {
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

let app: Application | undefined;
let handler: { fetch: (request: Request, env: unknown) => Response | Promise<Response> } | undefined;

/** Built once, then reused — by requests and by the cron trigger alike. */
async function boot(env: Env): Promise<Application> {
  if (!app) {
    setConnection(d1Connection(env.DB), "sqlite");
    app = await createApplication(edgeProviders);
  }

  return app;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!handler) {
      handler = (await boot(env)).make(HttpKernel).build();
    }

    return handler.fetch(request, env);
  },

  /**
   * The cron trigger, wired to the scheduler.
   *
   * One trigger drives every scheduled task: `runDue` asks each task registered by
   * ScheduleServiceProvider whether it matches this minute and runs the ones that do.
   * Adding recurring work is a line in that provider — never a new entry here, and
   * never a new cron in wrangler.jsonc.
   *
   * `waitUntil` is what keeps the Worker alive past this handler returning. Without it
   * a task that hasn't resolved yet is killed mid-flight.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await boot(env);
    ctx.waitUntil(scheduler().runDue(new Date(event.scheduledTime)));
  },
};
