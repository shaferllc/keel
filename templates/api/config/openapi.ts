import { env } from "@shaferllc/keel/core";

/**
 * OpenAPI — Swagger UI at /docs, spec at /docs/openapi.json.
 */
export default {
  enabled: env("OPENAPI_ENABLED", true),
  path: "docs",
  title: "",
  version: "1.0.0",
  description: "Keel API starter",
  servers: [],
  public: env("OPENAPI_PUBLIC", false),
  cdn: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14",
  ignorePaths: ["/watch"],
};
