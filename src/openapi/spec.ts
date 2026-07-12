/**
 * Build an OpenAPI 3.0 document from Keel's own route table. Every registered
 * route already carries its methods, path, name, param constraints, and any
 * `.config(apiDoc(...))` metadata — that's the whole input. Paths and methods
 * come for free; request/response schemas come from the docs metadata a route
 * chose to attach. A route with no metadata still appears, just bare.
 */

import type { RouteDefinition } from "../core/http/router.js";
import type { OpenApiConfig } from "./config.js";
import { OPENAPI_KEY, type OperationDoc } from "./doc.js";
import { toJsonSchema } from "./zod.js";

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
}

/** `/users/:id` (and `:id?`) → `/users/{id}` — OpenAPI's path-template syntax. */
function toTemplate(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)\??/g, "{$1}");
}

/** The `:param` names in a path, in order. */
function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)\??/g)].map((m) => m[1]!);
}

/** An operationId that's stable and unique: the route name, else method + path. */
function operationId(route: RouteDefinition, method: string): string {
  if (route.name) return route.name;
  const slug = route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

/** Path parameters — from the URL template, enriched by any `params` schema/`where`. */
function pathParameters(route: RouteDefinition, doc?: OperationDoc): unknown[] {
  const paramsSchema = doc?.request?.params ? toJsonSchema(doc.request.params) : undefined;
  const props = (paramsSchema?.properties ?? {}) as Record<string, unknown>;
  return paramNames(route.path).map((name) => {
    const schema = (props[name] as Record<string, unknown>) ?? { type: "string" };
    // A `.where("id", /\d+/)` constraint becomes a pattern hint.
    if (route.wheres[name] && !("pattern" in schema)) {
      schema.pattern = `^${route.wheres[name]}$`;
    }
    return { name, in: "path", required: true, schema };
  });
}

/** Query parameters — expanded from a `query` schema's top-level properties. */
function queryParameters(doc?: OperationDoc): unknown[] {
  const schema = doc?.request?.query ? toJsonSchema(doc.request.query) : undefined;
  if (!schema?.properties) return [];
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(schema.properties as Record<string, unknown>).map(([name, propSchema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: propSchema,
  }));
}

const HAS_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Build one operation object for a (route, method) pair. */
function buildOperation(route: RouteDefinition, method: string, doc: OperationDoc | undefined): unknown {
  const op: Record<string, unknown> = {
    operationId: doc?.operationId ?? operationId(route, method),
    tags: doc?.tags ?? [defaultTag(route.path)],
    parameters: [...pathParameters(route, doc), ...queryParameters(doc)],
  };
  if (doc?.summary) op.summary = doc.summary;
  if (doc?.description) op.description = doc.description;
  if (doc?.deprecated) op.deprecated = true;

  const body = doc?.request?.body ? toJsonSchema(doc.request.body) : undefined;
  if (body && HAS_BODY.has(method)) {
    op.requestBody = { required: true, content: { "application/json": { schema: body } } };
  }

  op.responses = buildResponses(doc);
  return op;
}

/** Responses from the docs, or a sensible default, plus a 422 when input is validated. */
function buildResponses(doc?: OperationDoc): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  if (doc?.responses) {
    for (const [status, res] of Object.entries(doc.responses)) {
      const schema = res.schema ? toJsonSchema(res.schema) : undefined;
      responses[status] = {
        description: res.description ?? "",
        ...(schema ? { content: { "application/json": { schema } } } : {}),
      };
    }
  }
  if (!Object.keys(responses).length) responses["200"] = { description: "OK" };
  // A documented request means validation can reject it.
  if (doc?.request && !responses["422"]) {
    responses["422"] = { description: "Validation failed" };
  }
  return responses;
}

/** The tag for an undocumented route: its first path segment. */
function defaultTag(path: string): string {
  const seg = path.split("/").filter(Boolean)[0] ?? "default";
  return seg.startsWith(":") ? "default" : seg;
}

/** Whether a route is left out of the spec. */
function skip(route: RouteDefinition, config: OpenApiConfig, base: string): boolean {
  const doc = route.config?.[OPENAPI_KEY] as OperationDoc | undefined;
  if (doc?.hidden) return true;
  if (route.path.includes("*")) return true; // wildcard/asset routes aren't API endpoints
  if (route.path === base || route.path.startsWith(`${base}/`)) return true; // the docs' own routes
  return config.ignorePaths.some((p) => route.path.startsWith(p));
}

/** Assemble the whole document from the route table. */
export function buildSpec(
  routes: RouteDefinition[],
  config: OpenApiConfig,
  base: string,
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    if (skip(route, config, base)) continue;
    const doc = route.config?.[OPENAPI_KEY] as OperationDoc | undefined;
    const template = toTemplate(route.path);
    for (const method of route.methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      (paths[template] ??= {})[method.toLowerCase()] = buildOperation(route, method, doc);
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: config.title,
      version: config.version,
      ...(config.description ? { description: config.description } : {}),
    },
    ...(config.servers.length ? { servers: config.servers.map((url) => ({ url })) } : {}),
    paths,
  };
}
