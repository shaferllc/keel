import type { MiddlewareHandler } from "hono";
/** Logs each request with method, path, status, and duration. */
export declare const requestLogger: MiddlewareHandler;
