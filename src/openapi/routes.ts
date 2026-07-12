/**
 * The docs HTTP surface: the generated spec at `/openapi.json` and the Swagger UI
 * at the base path. The spec is built once, lazily, from the full route table
 * (which is complete only after the app has loaded its routes) and cached.
 * Both routes are behind the gate.
 */

import type { Router } from "../core/http/router.js";
import type { OpenApiConfig } from "./config.js";
import { buildSpec, type OpenApiDocument } from "./spec.js";
import { swaggerHtml } from "./ui.js";
import { passesGate } from "./gate.js";

export function registerOpenApiRoutes(
  r: Router,
  config: OpenApiConfig,
  router: Router,
  base: string,
): void {
  let cached: OpenApiDocument | undefined;
  const spec = (): OpenApiDocument => (cached ??= buildSpec(router.all(), config, base));

  r.get("/openapi.json", async (c) => {
    if (!(await passesGate(c, config))) return c.json({ error: "Forbidden" }, 403);
    return c.json(spec());
  }).name("spec");

  r.get("/", async (c) => {
    if (!(await passesGate(c, config))) return c.text("Forbidden", 403);
    return c.html(swaggerHtml(`${base}/openapi.json`, config));
  }).name("ui");
}
