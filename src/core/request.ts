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

/** Parse the FormData once per request (web-standard, edge-safe). */
const FORM_CACHE = new WeakMap<Request, FormData | null>();
async function cachedFormData(): Promise<FormData | null> {
  const raw = ctx().req.raw;
  if (FORM_CACHE.has(raw)) return FORM_CACHE.get(raw)!;
  let fd: FormData | null = null;
  try {
    fd = await raw.formData();
  } catch {
    fd = null;
  }
  FORM_CACHE.set(raw, fd);
  return fd;
}

/** Parse an Accept-style header into values ordered by q-weight. */
function parseAccept(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [value, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { value: value!.trim(), q: q ? parseFloat(q.split("=")[1]!) : 1 };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.value);
}

function negotiate(headerName: string, offered: string[]): string | null {
  const accepted = parseAccept(ctx().req.header(headerName));
  if (accepted.includes("*/*") || accepted.includes("*")) return offered[0] ?? null;
  for (const a of accepted) if (offered.includes(a)) return a;
  return null;
}

/* ------------------------------ url / host ----------------------------- */
/* Proxy-aware URL introspection: X-Forwarded-* wins over the raw URL, so an
 * app behind a TLS-terminating proxy sees the client's protocol and host. */

/** The first value of a (possibly comma-listed) header. */
function firstForwarded(name: string): string | undefined {
  const v = ctx().req.header(name);
  return v ? v.split(",")[0]!.trim() : undefined;
}

function requestProtocol(): string {
  return firstForwarded("x-forwarded-proto") ?? new URL(ctx().req.url).protocol.replace(/:$/, "");
}

function requestHost(): string {
  return firstForwarded("x-forwarded-host") ?? ctx().req.header("host") ?? new URL(ctx().req.url).host;
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
  // Koa-style `redirect("back")`: bounce to the Referer, or "/" if there isn't one.
  if (location === "back") location = c?.req.header("referer") ?? "/";
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
  /** Redirect to the `Referer` header, or `fallback` (default "/") if absent. */
  back(fallback?: string, status?: number): Response;
  /** Send a value — objects become JSON, everything else becomes text. */
  send(data: unknown, status?: number): Response;
  /** Set the response status (chainable). */
  status(code: number): ResponseHelper;
  /** Set a response header (chainable). */
  header(name: string, value: string): ResponseHelper;
  /** Set several response headers at once (chainable). */
  headers(map: Record<string, string>): ResponseHelper;
  /** Read a response header set so far (e.g. in middleware after `next()`). */
  getHeader(name: string): string | null;
  /** Whether a response header has been set. */
  hasHeader(name: string): boolean;
  /** Set the Content-Type (chainable). */
  type(mime: string): ResponseHelper;
  /** Mark the response as a downloadable attachment via Content-Disposition (chainable). */
  attachment(filename?: string): ResponseHelper;
  /** Append a value to a (possibly multi-value) header (chainable). */
  append(name: string, value: string): ResponseHelper;
  /** Remove a response header (chainable). */
  removeHeader(name: string): ResponseHelper;
  /** Queue a Set-Cookie on the response (chainable). */
  cookie(name: string, value: string, options?: CookieOptions): ResponseHelper;
  /** Clear a cookie (chainable). */
  clearCookie(name: string, options?: CookieOptions): ResponseHelper;
  /** Abort the request with an HTTP exception. */
  abort(message: string, status?: number): never;
  /** Abort only if the condition is truthy. */
  abortIf(condition: unknown, message: string, status?: number): void;
  /** Abort unless the condition is truthy. */
  abortUnless(condition: unknown, message: string, status?: number): void;
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
  back(fallback = "/", status) {
    return redirect(ctx().req.header("referer") ?? fallback, status);
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
  headers(map) {
    for (const [name, value] of Object.entries(map)) ctx().header(name, value);
    return response;
  },
  getHeader(name) {
    return ctx().res.headers.get(name);
  },
  hasHeader(name) {
    return ctx().res.headers.has(name);
  },
  type(mime) {
    ctx().header("content-type", mime);
    return response;
  },
  attachment(filename) {
    if (filename === undefined) {
      ctx().header("content-disposition", "attachment");
    } else {
      // Quote the ASCII-safe name; add RFC 5987 filename* for anything else.
      const ascii = filename.replace(/[^\x20-\x7e]/g, "?").replace(/["\\]/g, "_");
      const encoded = encodeURIComponent(filename);
      ctx().header(
        "content-disposition",
        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      );
    }
    return response;
  },
  append(name, value) {
    ctx().header(name, value, { append: true });
    return response;
  },
  removeHeader(name) {
    ctx().res.headers.delete(name);
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
  abortIf(condition, message, status = 400): void {
    if (condition) throw new HttpException(status, message);
  },
  abortUnless(condition, message, status = 400): void {
    if (!condition) throw new HttpException(status, message);
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
  /** The request protocol — "https" or "http" — honoring X-Forwarded-Proto. */
  get protocol(): string {
    return requestProtocol();
  },
  /** Whether the request came in over HTTPS. */
  get secure(): boolean {
    return requestProtocol() === "https";
  },
  /** The host with port, honoring X-Forwarded-Host (e.g. "example.com:443"). */
  get host(): string {
    return requestHost();
  },
  /** The host without port (e.g. "example.com"). */
  get hostname(): string {
    return requestHost().split(":")[0]!;
  },
  /** Scheme + host — "https://example.com" — with no trailing slash. */
  get origin(): string {
    return `${requestProtocol()}://${requestHost()}`;
  },
  /** The absolute request URL, rebuilt from the (proxy-aware) origin. */
  get fullUrl(): string {
    const u = new URL(ctx().req.url);
    return `${requestProtocol()}://${requestHost()}${u.pathname}${u.search}`;
  },
  /** The raw query string without the leading "?" (empty when none). */
  get querystring(): string {
    return new URL(ctx().req.url).search.replace(/^\?/, "");
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
  /**
   * The raw request body as text — for content types `json()`/`all()` don't
   * handle (XML, CSV, a custom format). Parse it yourself from here.
   */
  text(): Promise<string> {
    return ctx().req.text();
  },
  /** The raw request body as an ArrayBuffer (binary payloads). */
  arrayBuffer(): Promise<ArrayBuffer> {
    return ctx().req.arrayBuffer();
  },
  /** The raw request body as a Blob. */
  blob(): Promise<Blob> {
    return ctx().req.blob();
  },
  /** The raw web Request. */
  get raw(): Request {
    return ctx().req.raw;
  },
  /** The matched route: `{ name, pattern, methods, config }`. */
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
    const body: Record<string, unknown> = {};
    const ct = c.req.header("content-type") ?? "";
    try {
      if (ct.includes("application/json")) {
        Object.assign(body, await c.req.json());
      } else if (ct.includes("form")) {
        const fd = await cachedFormData();
        if (fd) for (const [k, v] of fd.entries()) if (!(v instanceof File)) body[k] = v;
      }
    } catch {
      /* no or invalid body — ignore */
    }
    return { ...query, ...body };
  },

  /** An uploaded file by field name (a web `File`), or undefined. */
  async file(name: string): Promise<File | undefined> {
    const fd = await cachedFormData();
    const value = fd?.get(name);
    return value instanceof File ? value : undefined;
  },

  /** All uploaded files for a field name. */
  async files(name: string): Promise<File[]> {
    const fd = await cachedFormData();
    return (fd?.getAll(name) ?? []).filter((v): v is File => v instanceof File);
  },

  /** Every uploaded file, grouped by field name. */
  async allFiles(): Promise<Record<string, File | File[]>> {
    const fd = await cachedFormData();
    const out: Record<string, File | File[]> = {};
    if (!fd) return out;
    for (const [key, value] of fd.entries()) {
      if (!(value instanceof File)) continue;
      const existing = out[key];
      if (existing === undefined) out[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else out[key] = [existing, value];
    }
    return out;
  },

  /** True if the request declares a body. */
  hasBody(): boolean {
    const c = ctx();
    return !!(c.req.header("content-length") || c.req.header("transfer-encoding"));
  },

  /** All request headers as an object. */
  headers(): Record<string, string> {
    return Object.fromEntries(ctx().req.raw.headers);
  },

  /** The full X-Forwarded-For chain (client first). */
  ips(): string[] {
    const xff = ctx().req.header("x-forwarded-for");
    return xff ? xff.split(",").map((s) => s.trim()) : [];
  },

  /** The best of the offered content types per the Accept header, or null. */
  accepts(types: string[]): string | null {
    return negotiate("accept", types);
  },
  /** Accepted content types, ordered by preference. */
  types(): string[] {
    return parseAccept(ctx().req.header("accept"));
  },
  /** The best of the offered languages per Accept-Language, or null. */
  language(languages: string[]): string | null {
    return negotiate("accept-language", languages);
  },
  /** Accepted languages, ordered by preference. */
  languages(): string[] {
    return parseAccept(ctx().req.header("accept-language"));
  },
  /** The best of the offered content encodings per Accept-Encoding, or null. */
  encoding(encodings: string[]): string | null {
    return negotiate("accept-encoding", encodings);
  },
  /** Accepted content encodings, ordered by preference. */
  encodings(): string[] {
    return parseAccept(ctx().req.header("accept-encoding"));
  },
  /** The best of the offered charsets per Accept-Charset, or null. */
  charset(charsets: string[]): string | null {
    return negotiate("accept-charset", charsets);
  },
  /** Accepted charsets, ordered by preference. */
  charsets(): string[] {
    return parseAccept(ctx().req.header("accept-charset"));
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
