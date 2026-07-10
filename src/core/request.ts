/**
 * Request helpers — reach the current request/response without threading the
 * Hono context (`c`) through every function.
 *
 *   index() {
 *     return json({ id: param("id") });
 *   }
 *
 * These resolve the active context from async-context storage, which the HTTP
 * kernel enables for every request. They only work inside a request.
 */

import { getContext } from "hono/context-storage";
import type { Context } from "hono";

/** The current request context. Throws if called outside a request. */
export function ctx(): Context {
  return getContext();
}

/* ------------------------------ responses ------------------------------ */

export function json(data: unknown, status?: number): Response {
  return ctx().json(data as never, status as never);
}

export function text(body: string, status?: number): Response {
  return ctx().text(body, status as never);
}

export function html(body: string, status?: number): Response {
  return ctx().html(body, status as never);
}

export function redirect(location: string, status?: number): Response {
  return ctx().redirect(location, status as never);
}

/* ------------------------------- request ------------------------------- */

/** A route parameter by name, or all of them when called with no argument. */
export function param(): Record<string, string>;
export function param(name: string): string;
export function param(name?: string): string | Record<string, string> {
  const c = ctx();
  return name ? (c.req.param(name) as string) : c.req.param();
}

/** A query-string value by name, or all of them when called with no argument. */
export function query(): Record<string, string>;
export function query(name: string): string | undefined;
export function query(name?: string): string | undefined | Record<string, string> {
  const c = ctx();
  return name ? c.req.query(name) : c.req.query();
}

/** A request header value. */
export function header(name: string): string | undefined {
  return ctx().req.header(name);
}

/** Parse the request body as JSON. */
export function body<T = unknown>(): Promise<T> {
  return ctx().req.json() as Promise<T>;
}

/** The raw Request. */
export function request(): Request {
  return ctx().req.raw;
}
