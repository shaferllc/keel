/**
 * Request helpers — reach the current request/response without threading the
 * Hono context (`c`) through every function.
 *
 *   index() {
 *     return json({ id: param("id") });
 *   }
 *
 *   `${request.method} ${request.path} → ${request.status}`
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

/* ---------------------------- request access --------------------------- */

/**
 * The current request/response, as a flat accessor:
 *
 *   request.method   request.path   request.url   request.status
 *   request.header("authorization")   request.param("id")
 *   await request.json()   request.raw
 */
export const request = {
  get method(): string {
    return ctx().req.method;
  },
  get path(): string {
    return ctx().req.path;
  },
  get url(): string {
    return ctx().req.url;
  },
  /** The response status (useful after `await next()` in middleware). */
  get status(): number {
    return ctx().res.status;
  },
  header(name: string): string | undefined {
    return ctx().req.header(name);
  },
  param(name?: string): string | Record<string, string> {
    const c = ctx();
    return name ? (c.req.param(name) as string) : c.req.param();
  },
  query(name?: string): string | undefined | Record<string, string> {
    const c = ctx();
    return name ? c.req.query(name) : c.req.query();
  },
  json<T = unknown>(): Promise<T> {
    return ctx().req.json() as Promise<T>;
  },
  /** The raw web Request. */
  get raw(): Request {
    return ctx().req.raw;
  },
};

/* --------- standalone shortcuts for the most common accessors ---------- */

export function param(): Record<string, string>;
export function param(name: string): string;
export function param(name?: string): string | Record<string, string> {
  const c = ctx();
  return name ? (c.req.param(name) as string) : c.req.param();
}

export function query(): Record<string, string>;
export function query(name: string): string | undefined;
export function query(name?: string): string | undefined | Record<string, string> {
  const c = ctx();
  return name ? c.req.query(name) : c.req.query();
}

export function header(name: string): string | undefined {
  return ctx().req.header(name);
}

export function body<T = unknown>(): Promise<T> {
  return ctx().req.json() as Promise<T>;
}
