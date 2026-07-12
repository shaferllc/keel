/**
 * OpenAPI configuration. Defaults live here and are merged under
 * `config("openapi")` by the provider; an app overrides them in
 * `config/openapi.ts` (publish it with `keel vendor:publish --tag openapi-config`).
 */

import { config } from "../core/helpers.js";

export interface OpenApiConfig {
  /** Master switch. Off → no docs routes and the spec 404s. */
  enabled: boolean;
  /** URL prefix the docs UI and spec mount under. Default: "docs". */
  path: string;
  /** The API title. Defaults to `config("app.name")`. */
  title: string;
  /** The API version string shown in the spec. */
  version: string;
  /** A longer description (Markdown) for the spec's `info`. */
  description?: string;
  /** Server URLs the API is served from (OpenAPI `servers`). */
  servers: string[];
  /** Serve the docs in production too. Off by default — docs expose your surface. */
  public: boolean;
  /** Swagger UI asset base (a CDN, or your own copy). Pin it to a version you trust. */
  cdn: string;
  /** Route path prefixes to leave out of the spec (the docs' own are always skipped). */
  ignorePaths: string[];
}

export const defaultConfig: OpenApiConfig = {
  enabled: true,
  path: "docs",
  title: "",
  version: "1.0.0",
  servers: [],
  public: false,
  cdn: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14",
  ignorePaths: [],
};

/** Read the effective OpenAPI config, filling gaps (title falls back to app name). */
export function resolveConfig(): OpenApiConfig {
  const raw = config<Partial<OpenApiConfig>>("openapi", {});
  return {
    ...defaultConfig,
    ...raw,
    title: raw.title || config<string>("app.name", "API"),
  };
}
