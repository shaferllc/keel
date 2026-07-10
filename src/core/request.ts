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
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { HttpException } from "./exceptions.js";

type CookieOptions = Parameters<typeof setCookie>[3];

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
  /** Send a value — objects become JSON, everything else becomes text. */
  send(data: unknown, status?: number): Response;
  /** Set the response status (chainable). */
  status(code: number): ResponseHelper;
  /** Set a response header (chainable). */
  header(name: string, value: string): ResponseHelper;
  /** Queue a Set-Cookie on the response (chainable). */
  cookie(name: string, value: string, options?: CookieOptions): ResponseHelper;
  /** Clear a cookie (chainable). */
  clearCookie(name: string, options?: CookieOptions): ResponseHelper;
  /** Abort the request with an HTTP exception. */
  abort(message: string, status?: number): never;
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
  send(data, status) {
    return typeof data === "object" && data !== null
      ? json(data, status)
      : text(String(data), status);
  },
  status(code) {
    ctx().status(code as never);
    return response;
  },
  header(name, value) {
    ctx().header(name, value);
    return response;
  },
  cookie(name, value, options) {
    setCookie(ctx(), name, value, options);
    return response;
  },
  clearCookie(name, options) {
    deleteCookie(ctx(), name, options);
    return response;
  },
  abort(message, status = 400): never {
    throw new HttpException(status, message);
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

  /** A request cookie by name, or all cookies when called with no argument. */
  cookie(name?: string): string | undefined | Record<string, string> {
    return name ? getCookie(ctx(), name) : getCookie(ctx());
  },

  /** The client IP, from X-Forwarded-For / X-Real-IP. */
  ip(): string | undefined {
    const c = ctx();
    return (
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      undefined
    );
  },

  /** All inputs — query string merged with the parsed body (async). */
  async all(): Promise<Record<string, unknown>> {
    const c = ctx();
    const query = c.req.query();
    let body: Record<string, unknown> = {};
    try {
      const ct = c.req.header("content-type") ?? "";
      if (ct.includes("application/json")) {
        body = (await c.req.json()) as Record<string, unknown>;
      } else if (ct.includes("form")) {
        body = (await c.req.parseBody()) as Record<string, unknown>;
      }
    } catch {
      /* no or invalid body — ignore */
    }
    return { ...query, ...body };
  },

  /** A single input (from query or body), with an optional fallback (async). */
  async input<T = unknown>(key: string, fallback?: T): Promise<T> {
    const all = await this.all();
    return (key in all ? (all[key] as T) : (fallback as T));
  },

  /** Only the named inputs (async). */
  async only(keys: string[]): Promise<Record<string, unknown>> {
    const all = await this.all();
    return Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));
  },

  /** Every input except the named ones (async). */
  async except(keys: string[]): Promise<Record<string, unknown>> {
    const all = await this.all();
    return Object.fromEntries(Object.entries(all).filter(([k]) => !keys.includes(k)));
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
