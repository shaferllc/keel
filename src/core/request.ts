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

/** The context if there is one, else undefined — never throws. */
function maybeCtx(): Context | undefined {
  try {
    return getContext();
  } catch {
    return undefined;
  }
}

/* ------------------------------ responses ------------------------------ */
/* These work inside a handler AND standalone (e.g. as a static route value).
 * Inside a request they build on the context (merging any headers); outside a
 * request they return a plain Response, so `router.get("/ping", json({...}))`
 * works — the router clones it per request. */

export function json(data: unknown, status?: number): Response {
  const c = maybeCtx();
  return c
    ? c.json(data as never, status as never)
    : Response.json(data, status ? { status } : undefined);
}

export function text(body: string, status?: number): Response {
  const c = maybeCtx();
  return c
    ? c.text(body, status as never)
    : new Response(body, {
        status,
        headers: { "content-type": "text/plain; charset=UTF-8" },
      });
}

export function html(body: string, status?: number): Response {
  const c = maybeCtx();
  return c
    ? c.html(body, status as never)
    : new Response(body, {
        status,
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
}

export function redirect(location: string, status?: number): Response {
  const c = maybeCtx();
  return c
    ? c.redirect(location, status as never)
    : new Response(null, { status: status ?? 302, headers: { location } });
}

/* ---------------------------- response access -------------------------- */

/**
 * The response, as a flat accessor mirroring `request`:
 *
 *   response.json({ ok: true });
 *   response.text("hello");   response.html("<h1>Hi</h1>");
 *   response.redirect("/login");
 *   response.status(201).json(created);   // chainable
 */
interface ResponseHelper {
  json(data: unknown, status?: number): Response;
  text(body: string, status?: number): Response;
  html(body: string, status?: number): Response;
  redirect(location: string, status?: number): Response;
  /** Set the response status (chainable). */
  status(code: number): ResponseHelper;
  /** Set a response header (chainable). */
  header(name: string, value: string): ResponseHelper;
}

export const response: ResponseHelper = {
  json(data, status) {
    return json(data, status);
  },
  text(body, status) {
    return text(body, status);
  },
  html(body, status) {
    return html(body, status);
  },
  redirect(location, status) {
    return redirect(location, status);
  },
  status(code) {
    ctx().status(code as never);
    return response;
  },
  header(name, value) {
    ctx().header(name, value);
    return response;
  },
};

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
  /** The matched route: `{ name, pattern, methods }`. */
  get route() {
    return ctx().get("route");
  },
  /** Whether the matched route has the given name. */
  routeIs(name: string): boolean {
    return ctx().get("route")?.name === name;
  },
  /** A subdomain parameter captured from a domain-bound route. */
  subdomain(name: string): string | undefined {
    return ctx().get("subdomains")?.[name];
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
