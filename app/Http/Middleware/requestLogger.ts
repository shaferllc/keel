import type { MiddlewareHandler } from "hono";

/** Logs each request with method, path, status, and duration. */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
};
