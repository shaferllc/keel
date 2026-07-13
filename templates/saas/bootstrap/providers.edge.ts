import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";
import { TeamsServiceProvider } from "@shaferllc/keel/teams";
import { BillingServiceProvider } from "@shaferllc/keel/billing";
import { WatchServiceProvider } from "@shaferllc/keel/watch";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";

/**
 * Providers for the Worker. `DatabaseServiceProvider` is deliberately absent —
 * it reaches for `pg` (net/tls). worker.ts binds D1 before boot.
 */
export const edgeProviders: ProviderClass[] = [
  AccountsServiceProvider,
  TeamsServiceProvider,
  BillingServiceProvider,
  WatchServiceProvider,
  AppServiceProvider,
];
