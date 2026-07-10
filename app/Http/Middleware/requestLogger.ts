import type { MiddlewareHandler } from "hono";
import { request } from "@keel/core";

/** Logs each request with method, path, status, and duration. */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ${request.method} ${request.path} → ${request.status} (${ms}ms)`);
};
