import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";
import { TeamsServiceProvider } from "@shaferllc/keel/teams";
import { BillingServiceProvider } from "@shaferllc/keel/billing";
import { ApiServiceProvider } from "@shaferllc/keel/api";
import { OpenApiServiceProvider } from "@shaferllc/keel/openapi";
import { WatchServiceProvider } from "@shaferllc/keel/watch";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { ScheduleServiceProvider } from "../app/Providers/ScheduleServiceProvider.js";

/**
 * Providers for the Worker. Two deliberate omissions.
 *
 * `DatabaseServiceProvider` reaches for `pg` (net/tls) — worker.ts binds D1 before boot
 * instead.
 *
 * `BackgroundServiceProvider` holds a `setInterval` open to drain the queue, and a
 * Worker may not keep a timer running between requests: it would accept jobs that never
 * ran. So on the edge the queue stays the default `SyncDriver` — jobs execute inline, on
 * the request — and the cron trigger drives the scheduler through the `scheduled`
 * handler in worker.ts. When inline work gets too slow here, the fix is a Cloudflare
 * Queue binding behind a custom driver, not a timer.
 *
 * `ScheduleServiceProvider` *is* here: it only declares the cadences, and `scheduled`
 * needs those declarations to know what is due.
 */
export const edgeProviders: ProviderClass[] = [
  AccountsServiceProvider,
  TeamsServiceProvider,
  BillingServiceProvider,
  ApiServiceProvider,
  OpenApiServiceProvider,
  WatchServiceProvider,

  ScheduleServiceProvider,

  AppServiceProvider,
];
