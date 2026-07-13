import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";
import { TeamsServiceProvider } from "@shaferllc/keel/teams";
import { BillingServiceProvider } from "@shaferllc/keel/billing";
import { ApiServiceProvider } from "@shaferllc/keel/api";
import { OpenApiServiceProvider } from "@shaferllc/keel/openapi";
import { WatchServiceProvider } from "@shaferllc/keel/watch";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { BackgroundServiceProvider } from "../app/Providers/BackgroundServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";
import { ScheduleServiceProvider } from "../app/Providers/ScheduleServiceProvider.js";

/**
 * Providers for the Node runtime.
 *
 * Teams and billing know nothing about each other. Billing parameterizes what it
 * charges (`billableModel` / `billableTable`), so *this app* points it at teams —
 * the team is the customer.
 *
 * `BackgroundServiceProvider` is the one entry with no edge counterpart: it holds a
 * timer open to drain the queue, and a Worker may not keep one running between
 * requests. See providers.edge.ts.
 */
export const providers: ProviderClass[] = [
  DatabaseServiceProvider,
  AccountsServiceProvider,
  TeamsServiceProvider,
  BillingServiceProvider,
  ApiServiceProvider,
  OpenApiServiceProvider,
  WatchServiceProvider,

  ScheduleServiceProvider,
  BackgroundServiceProvider,

  AppServiceProvider,
];
