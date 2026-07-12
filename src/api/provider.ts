/**
 * Optional provider for the API-resource layer. `apiResource()` works without it —
 * it just reads sensible defaults. Register this to override the pagination
 * defaults in `config/api.ts` and to publish that stub.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";
import { defaultConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

export class ApiServiceProvider extends PackageProvider {
  readonly name = "api";

  register(): void {
    this.mergeConfig("api", defaultConfig as unknown as Record<string, unknown>);
    this.publishes({ [join(here, "api.config.stub")]: "config/api.ts" }, "api-config");
  }
}
