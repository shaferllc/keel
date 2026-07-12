/**
 * Keel OpenAPI — generate an OpenAPI 3 spec from your routes and serve Swagger UI,
 * shipped as a Keel package. One line turns it on:
 *
 *   app.register(OpenApiServiceProvider);
 *
 * The spec is built from Keel's own route table plus whatever each route attaches
 * with `.config(apiDoc(...))`. Nothing is scraped or guessed: paths and methods
 * are always right, and schemas are as rich as the metadata a route provides.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";
import type { Router } from "../core/http/router.js";
import { resolveConfig, defaultConfig, type OpenApiConfig } from "./config.js";
import { registerOpenApiRoutes } from "./routes.js";
import { exportCommand } from "./export.js";

const here = dirname(fileURLToPath(import.meta.url));

export class OpenApiServiceProvider extends PackageProvider {
  readonly name = "openapi";

  private config!: OpenApiConfig;

  private base(): string {
    return "/" + this.config.path.replace(/^\/|\/$/g, "");
  }

  register(): void {
    this.mergeConfig("openapi", defaultConfig as unknown as Record<string, unknown>);
    this.config = resolveConfig();
    this.publishes({ [join(here, "openapi.config.stub")]: "config/openapi.ts" }, "openapi-config");
    this.commands([exportCommand(() => this.app.router(), this.config, this.base())]);
  }

  boot(): void {
    if (!this.config.enabled) return;
    this.routes(
      (r: Router) => registerOpenApiRoutes(r, this.config, this.app.router(), this.base()),
      { prefix: this.config.path, as: "openapi" },
    );
  }
}
