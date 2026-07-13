// Type-check harness for docs/packages.md. Compile-only — never executed.
import { PackageProvider, type Router, type Migration, type PackageCommand } from "@shaferllc/keel/core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

declare const createInvoicesTable: Migration;
declare const syncInvoicesCommand: PackageCommand;
declare function registerBillingRoutes(r: Router): void;

export class BillingServiceProvider extends PackageProvider {
  readonly name = "billing";

  register(): void {
    this.mergeConfig("billing", { enabled: true, path: "billing" });
    this.migrations([createInvoicesTable]);
    this.publishes({ [join(here, "config.stub")]: "config/billing.ts" }, "billing-config");
    this.commands([syncInvoicesCommand]);
  }

  boot(): void {
    this.assets("billing/assets", join(here, "ui/dist"), { maxAge: 3600 });
    this.routes((r: Router) => registerBillingRoutes(r), { prefix: "billing", as: "billing" });
  }
}
