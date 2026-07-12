/**
 * Teams — multi-tenancy, membership, roles, and invitations, shipped as a Keel
 * package. One line in `bootstrap/providers.ts`:
 *
 *   app.register(TeamsServiceProvider)
 *
 * Then put your requests inside a team, and every `TenantModel` is scoped:
 *
 *   // app/Http/Kernel.ts
 *   protected middleware = [sessionMiddleware(), teamContext()];
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";

import { defaultConfig, resolveConfig, type TeamsConfig } from "./config.js";
import { teamsMigration } from "./migration.js";

const here = dirname(fileURLToPath(import.meta.url));

export class TeamsServiceProvider extends PackageProvider {
  readonly name = "teams";

  private config!: TeamsConfig;

  register(): void {
    this.mergeConfig("teams", defaultConfig as unknown as Record<string, unknown>);
    this.config = resolveConfig();

    this.migrations([teamsMigration(this.config.userTable)]);
    this.publishes({ [join(here, "teams.config.stub")]: "config/teams.ts" }, "teams-config");
  }
}
