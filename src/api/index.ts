/**
 * Keel API resources — a full CRUD REST API from a model, imported from
 * `@shaferllc/keel/api`.
 *
 *   import { apiResource } from "@shaferllc/keel/api";
 *   apiResource(router, Post, { filter: ["status"], body: PostSchema, access: { read: true } });
 *
 * The generated routes are documented automatically by `@shaferllc/keel/openapi`.
 */

export { apiResource } from "./resource.js";
export type {
  ApiResourceOptions,
  ApiAccess,
  Access,
  ApiAction,
  ApiTransform,
  ModelStatic,
} from "./resource.js";
export { ApiServiceProvider } from "./provider.js";
export { defaultConfig, apiDefaults } from "./config.js";
export type { ApiConfig } from "./config.js";
export { parseListParams, applyListParams } from "./query.js";
export type { ListParams, ListQueryOptions } from "./query.js";
