// Type-check harness for docs/security.md. Compile-only — never executed.
import type { MiddlewareHandler } from "hono";
import {
  securityHeaders,
  csrf,
  csrfField,
  csrfToken,
  sessionMiddleware,
} from "@shaferllc/keel/core";

export function headers(): MiddlewareHandler[] {
  return [
    securityHeaders(),
    securityHeaders({
      csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://cdn.example.com"] },
      hsts: { maxAge: 15552000, includeSubDomains: true },
      frameGuard: "DENY",
    }),
  ];
}

export function csrfStack(): MiddlewareHandler[] {
  return [sessionMiddleware(), csrf(), csrf({ except: ["/billing/webhook/*"] })];
}

export function forms() {
  return {
    field: csrfField(),
    token: csrfToken(),
  };
}
