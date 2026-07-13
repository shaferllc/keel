/**
 * Keel Billing — subscription billing covering Stripe and Paddle, shipped as a
 * Keel package. One line in `bootstrap/providers.ts` turns it on:
 *
 *   app.register(BillingServiceProvider)
 *
 * `register()` merges config, wires the gateway drivers onto a manager, installs
 * that manager as the module singleton (so `Billable` models can reach it
 * without DI), contributes the schema migration, and declares the publishable
 * config stub. `boot()` mounts the webhook route.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";
import type { Router } from "../core/http/router.js";
import { resolveConfig, defaultConfig, type BillingConfig } from "./config.js";
import { BillingManager, setBilling } from "./manager.js";
import { registerDefaultGateways } from "./drivers/index.js";
import { billingMigration } from "./migration.js";
import { registerBillingRoutes } from "./routes.js";

function packageDir(): string {
  try {
    const url = import.meta.url;
    if (!url) return ".";
    return dirname(fileURLToPath(url));
  } catch {
    return ".";
  }
}

export class BillingServiceProvider extends PackageProvider {
  readonly name = "billing";

  private config!: BillingConfig;
  private manager!: BillingManager;

  register(): void {
    this.mergeConfig("billing", defaultConfig as unknown as Record<string, unknown>);
    this.config = resolveConfig();

    this.manager = new BillingManager(this.config);
    registerDefaultGateways(this.manager);
    setBilling(this.manager);
    this.app.instance(BillingManager, this.manager);

    // Default billable table is `users`.
    this.migrations([billingMigration("users")]);
    this.publishes({ [join(packageDir(), "billing.config.stub")]: "config/billing.ts" }, "billing-config");
  }

  boot(): void {
    this.routes((r: Router) => registerBillingRoutes(r, this.config.webhook.path));
  }

  shutdown(): void {
    setBilling(undefined);
  }
}
