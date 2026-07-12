import type { ProviderClass } from "@shaferllc/keel/core";
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";

import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { DatabaseServiceProvider } from "../app/Providers/DatabaseServiceProvider.js";

/**
 * Providers for the Node runtime (`keel serve`, the console, migrations).
 *
 * AccountsServiceProvider brings password reset, email verification, and two-factor —
 * routes, migration and all. The flows live in the framework, tested once, rather
 * than being copy-pasted into every app that has a login.
 */
export const providers: ProviderClass[] = [
  DatabaseServiceProvider,
  AccountsServiceProvider,
  AppServiceProvider,
];
