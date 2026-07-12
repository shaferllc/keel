/**
 * Accounts — password reset, email verification, and two-factor, shipped as a Keel
 * package. One line in `bootstrap/providers.ts` turns it on:
 *
 *   app.register(AccountsServiceProvider)
 *
 * `register()` merges config, installs the store, and contributes the migration.
 * `boot()` mounts the JSON endpoints (unless you've turned them off and would
 * rather call the flow functions from your own controllers).
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";
import type { Router } from "../core/http/router.js";

import { defaultConfig, resolveConfig, type AccountsConfig } from "./config.js";
import { accountsMigration } from "./migration.js";
import { registerAccountsRoutes } from "./routes.js";
import { setAccountStore, tableStore } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));

export class AccountsServiceProvider extends PackageProvider {
  readonly name = "accounts";

  private config!: AccountsConfig;

  register(): void {
    this.mergeConfig("accounts", defaultConfig as unknown as Record<string, unknown>);
    this.config = resolveConfig();

    setAccountStore(tableStore(this.config.userTable));

    this.migrations([accountsMigration(this.config.userTable)]);
    this.publishes({ [join(here, "accounts.config.stub")]: "config/accounts.ts" }, "accounts-config");
  }

  boot(): void {
    if (!this.config.routes.enabled) return;
    this.routes((r: Router) => registerAccountsRoutes(r, this.config));
  }

  shutdown(): void {
    setAccountStore(undefined);
  }
}
