// Type-check harness for docs/rate-limiting.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed option or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import { rateLimiter, type RateLimiterOptions } from "@shaferllc/keel/core";
import type { Context, MiddlewareHandler } from "hono";

// Externals referenced by the narrative but not part of this module.
declare const app: { use(mw: MiddlewareHandler): void };

export function globalAndPerRoute() {
  app.use(rateLimiter({ max: 60, window: 60 }));
  app.use(rateLimiter({ max: 5, window: 60 }));
}

export function options() {
  rateLimiter({
    max: 60,
    window: 60,
    key: (c: Context) => c.req.header("x-api-key") ?? "anon",
    message: "Slow down!",
  });
}

export function defaults(): MiddlewareHandler {
  // no arguments: 60 req / 60s, keyed by IP
  return rateLimiter();
}

export function reused() {
  const limit: MiddlewareHandler = rateLimiter({ max: 100, window: 60 });
  return limit;
}

// Interface / type seam
const perUser: RateLimiterOptions = {
  max: 30,
  window: 60,
  key: (c) => c.req.header("authorization") ?? "anon",
  message: "Easy there — try again shortly.",
};
const mw: MiddlewareHandler = rateLimiter(perUser);
export { perUser, mw };
