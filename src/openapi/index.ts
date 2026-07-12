/**
 * Keel OpenAPI — spec generation + Swagger UI for Keel apps, imported from
 * `@shaferllc/keel/openapi`.
 *
 *   import { OpenApiServiceProvider } from "@shaferllc/keel/openapi";
 *   app.register(OpenApiServiceProvider);      // serves /docs and /docs/openapi.json
 *
 * Document a route with `apiDoc()`; lock the docs down with `OpenApi.auth()`.
 */

export { OpenApiServiceProvider } from "./provider.js";
export { OpenApi } from "./gate.js";
export type { OpenApiGate } from "./gate.js";
export { apiDoc, OPENAPI_KEY } from "./doc.js";
export type { OperationDoc, ResponseDoc } from "./doc.js";
export { buildSpec } from "./spec.js";
export type { OpenApiDocument } from "./spec.js";
export { toJsonSchema } from "./zod.js";
export { resolveConfig, defaultConfig } from "./config.js";
export type { OpenApiConfig } from "./config.js";
