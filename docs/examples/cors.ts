// Type-check harness for docs/cors.md. Compile-only — never executed.
import type { MiddlewareHandler } from "hono";
import { cors, type CorsOptions } from "@shaferllc/keel/core";

export function kernel(): MiddlewareHandler {
  return cors();
}

export function apiGroup(): MiddlewareHandler {
  return cors({ origin: ["https://app.example.com"] });
}

export function production(): MiddlewareHandler {
  const options: CorsOptions = {
    origin: ["https://app.example.com"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    headers: true,
    exposeHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 86400,
  };
  return cors(options);
}

export function dynamicOrigin(): MiddlewareHandler {
  return cors({
    origin: (origin) => origin.endsWith(".example.com") || origin.startsWith("http://localhost"),
  });
}
