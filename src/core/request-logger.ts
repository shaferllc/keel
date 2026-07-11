/**
 * Per-request logging. `requestLogger()` middleware binds a child logger to each
 * request with a generated `reqId`, so every log line within that request
 * correlates — Fastify's `request.log`, built on Keel's `Logger.child()`. It can
 * also log the request start and completion (method, path, status, duration).
 *
 *   kernel.use(requestLogger());          // in app/Http/Kernel.ts
 *   requestLog().info("charging card");   // anywhere in the request → carries reqId
 */

import type { Context, MiddlewareHandler } from "hono";
import { ctx } from "./request.js";
import { logger } from "./helpers.js";
import type { Logger } from "./logger.js";

// The child logger for the current request, keyed by the context object.
const store = new WeakMap<Context, Logger>();

export interface RequestLoggerOptions {
  /** Generate the request id. Default: `crypto.randomUUID()`. */
  genReqId?: (c: Context) => string;
  /** Reuse an incoming id from this header if present (e.g. `"x-request-id"`). */
  idHeader?: string;
  /** Log request start and completion lines. Default: true. */
  logRequests?: boolean;
}

/** Middleware: attach a per-request child logger (with `reqId`) and log the request. */
export function requestLogger(options: RequestLoggerOptions = {}): MiddlewareHandler {
  const { genReqId, idHeader, logRequests = true } = options;
  return async (c, next) => {
    const incoming = idHeader ? c.req.header(idHeader) : undefined;
    const reqId = incoming ?? (genReqId ? genReqId(c) : crypto.randomUUID());
    const log = logger().child({ reqId });
    store.set(c, log);

    const start = performance.now();
    if (logRequests) log.info("request", { method: c.req.method, path: c.req.path });
    await next();
    if (logRequests) {
      log.info("request completed", {
        status: c.res.status,
        ms: Number((performance.now() - start).toFixed(1)),
      });
    }
  };
}

/**
 * The current request's child logger (carrying its `reqId`), or the base logger
 * when called outside a request or without `requestLogger()` installed.
 */
export function requestLog(): Logger {
  try {
    const log = store.get(ctx());
    if (log) return log;
  } catch {
    // not in a request context
  }
  return logger();
}
