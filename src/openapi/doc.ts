/**
 * Route documentation metadata. Attach it to a route with `.config(apiDoc(...))`
 * and the generator turns it into a rich OpenAPI operation — request/response
 * schemas, summary, tags. Request schemas reuse Keel's `RequestSchemas` shape, so
 * the very object you hand `validateRequest({ body })` also documents the route.
 *
 *   router
 *     .post("/users", [Users, "store"])
 *     .config(apiDoc({ summary: "Create a user", request: { body: NewUser }, tags: ["users"] }))
 *     .middleware([validateRequest({ body: NewUser })]);
 */

import type { RequestSchemas } from "../core/validation.js";

/** The key under which docs metadata lives in a route's `config`. */
export const OPENAPI_KEY = "openapi";

/** One response's documentation: a description and an optional body schema. */
export interface ResponseDoc {
  description?: string;
  /** A Zod schema or a plain JSON Schema object for the response body. */
  schema?: unknown;
}

/** Everything a route can say about itself for the spec. */
export interface OperationDoc {
  summary?: string;
  description?: string;
  tags?: string[];
  /** Overrides the generated operationId (default: the route name). */
  operationId?: string;
  deprecated?: boolean;
  /** Request body/query/params schemas — Zod or plain JSON Schema. */
  request?: RequestSchemas;
  /** Responses keyed by status code, e.g. `{ 200: { schema: User }, 404: {} }`. */
  responses?: Record<string | number, ResponseDoc>;
  /** Leave this route out of the spec entirely. */
  hidden?: boolean;
}

/**
 * Wrap operation docs for a route's `.config()`. Returns `{ openapi: doc }`, which
 * the generator reads off `RouteDefinition.config`.
 */
export function apiDoc(doc: OperationDoc): Record<string, unknown> {
  return { [OPENAPI_KEY]: doc };
}
