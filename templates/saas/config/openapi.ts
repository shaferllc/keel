import { env } from "@shaferllc/keel/core";

/**
 * OpenAPI — Swagger UI at /docs, spec at /docs/openapi.json.
 *
 * `public: false` keeps both shut in production. The spec lists every route and every
 * body you accept, which is a serviceable map of your attack surface — worth opening
 * deliberately rather than by default.
 *
 * The billing webhooks are ignored: the gateway calls them, no client does, and a
 * signature-verified endpoint in a client-facing spec is just noise.
 */
export default {
  enabled: env("OPENAPI_ENABLED", true),
  path: "docs",
  title: "",
  version: "1.0.0",
  description: "Keel SaaS API",
  servers: [],
  public: env("OPENAPI_PUBLIC", false),
  cdn: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14",
  ignorePaths: ["/watch", "/billing/webhook"],
};
