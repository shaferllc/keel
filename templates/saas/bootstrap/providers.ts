import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";
import { TeamsServiceProvider } from "@shaferllc/keel/teams";
import { BillingServiceProvider } from "@shaferllc/keel/billing";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";

/**
 * Providers for the Node runtime.
 *
 * Teams and billing know nothing about each other. Billing parameterizes what it
 * charges (`billableModel`), so *this app* points it at teams — the team is the
 * customer. That seam is what keeps them from becoming one tangled module.
 */
export const providers: ProviderClass[] = [
  DatabaseServiceProvider,
  AccountsServiceProvider,
  TeamsServiceProvider,
  BillingServiceProvider,
  AppServiceProvider,
];
