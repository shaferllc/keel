import { PackageProvider } from "../core/package.js";
import { gatesMigration } from "./models.js";

/**
 * Signup gates — invite codes + email allowlist.
 *
 *   app.register(GatesServiceProvider)
 */
export class GatesServiceProvider extends PackageProvider {
  readonly name = "gates";

  register(): void {
    this.migrations([gatesMigration()]);
  }
}
