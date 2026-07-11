/**
 * Router facade. Collects route definitions declaratively; the HTTP kernel
 * compiles them onto the underlying Hono instance at boot.
 *
 * Fluent, AdonisJS-inspired API: named routes, per-route and group middleware,
 * prefixes, param constraints, resource routes, and URL generation.
 */

import type { Context as HonoContext, MiddlewareHandler } from "hono";
import type { Container, Constructor } from "../container.js";
import { view, config } from "../helpers.js";
import { redirect as makeRedirect, request } from "../request.js";
import { inertia } from "../inertia.js";

/** HMAC-SHA256 hex signature (Web Crypto — works on Node and the edge). */
async function hmac(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function appKey(): string {
  const key = config<string>("app.key", "");
  if (!key) throw new Error("Signed URLs require config('app.key'). Set APP_KEY.");
  return key;
}

export interface UrlOptions {
  qs?: Record<string, string | number>;
}
export interface SignedUrlOptions extends UrlOptions {
  /** Expiry in seconds from now. */
  expiresIn?: number;
}

/** The request context handed to every route handler and middleware. */
export type Ctx = HonoContext;

/** A route-parameter constraint: a regex, a source string, or `{ match }`. */
export type Matcher = RegExp | string | { match: RegExp };

function matcherSource(m: Matcher): string {
  if (typeof m === "string") return m;
  if (m instanceof RegExp) return m.source;
  return m.match.source;
}

/** Built-in parameter matchers, à la `router.matchers.number()`. */
export const matchers = {
  number: () => /\d+/,
  uuid: () => /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  slug: () => /[a-z0-9]+(?:-[a-z0-9]+)*/,
  alpha: () => /[a-zA-Z]+/,
};

export type HandlerFn = (c: Ctx) => Response | string | Promise<Response | string>;

/** A controller class, or a lazy `() => import(...)` loader of one. */
export type LazyController = () => Promise<{ default: Constructor } | Constructor>;
export type ControllerRef = Constructor | LazyController;

/**
 * A controller action: `[Controller, "method"]`, or `[Controller]` for a
 * single-action controller (calls `handle`). The controller may be a lazy
 * `() => import(...)` loader.
 */
export type ControllerAction = [ControllerRef] | [ControllerRef, string];

/** A function, a controller action, or a ready-made Response. */
export type RouteHandler = HandlerFn | ControllerAction | Response;

/** A middleware handler, or the name of one registered with `router.named()`. */
export type MiddlewareRef = MiddlewareHandler | string;

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
const ALL: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

export interface RouteDefinition {
  methods: Method[];
  path: string;
  handler: RouteHandler;
  name?: string;
  middleware: MiddlewareRef[];
  wheres: Record<string, string>;
  /** Host pattern this route is bound to, e.g. ":tenant.example.com". */
  domain?: string;
}

/** A single registered route — chain to name it, guard it, or constrain params. */
export class Route {
  constructor(public readonly def: RouteDefinition) {}

  /** Give the route a name for URL generation. */
  name(name: string): this {
    this.def.name = name;
    return this;
  }
  /** Alias for name(). */
  as(name: string): this {
    return this.name(name);
  }

  /** Attach middleware that runs only for this route (after group middleware). */
  middleware(mw: MiddlewareRef | MiddlewareRef[]): this {
    this.def.middleware.push(...(Array.isArray(mw) ? mw : [mw]));
    return this;
  }
  /** Alias for middleware(), matching AdonisJS. */
  use(mw: MiddlewareRef | MiddlewareRef[]): this {
    return this.middleware(mw);
  }

  /** Constrain a route parameter with a regex, source string, or matcher. */
  where(param: string, matcher: Matcher): this {
    this.def.wheres[param] = matcherSource(matcher);
    return this;
  }

  /** Bind this route to a host pattern (supports `:subdomain` segments). */
  domain(pattern: string): this {
    this.def.domain = pattern;
    return this;
  }
}

/** A group of routes sharing a prefix, middleware, and/or name prefix. */
export class RouteGroup {
  constructor(private routes: RouteDefinition[]) {}

  prefix(prefix: string): this {
    const p = "/" + prefix.replace(/^\/|\/$/g, "");
    for (const r of this.routes) r.path = (p + r.path).replace(/\/$/, "") || "/";
    return this;
  }

  middleware(mw: MiddlewareRef | MiddlewareRef[]): this {
    const list = Array.isArray(mw) ? mw : [mw];
    for (const r of this.routes) r.middleware.unshift(...list); // group runs first
    return this;
  }
  /** Alias for middleware(), matching AdonisJS. */
  use(mw: MiddlewareRef | MiddlewareRef[]): this {
    return this.middleware(mw);
  }

  /** Constrain a parameter across every route in the group. */
  where(param: string, matcher: Matcher): this {
    for (const r of this.routes) {
      if (!(param in r.wheres)) r.wheres[param] = matcherSource(matcher);
    }
    return this;
  }

  as(namePrefix: string): this {
    for (const r of this.routes) if (r.name) r.name = `${namePrefix}.${r.name}`;
    return this;
  }

  /** Bind every route in the group to a host pattern. */
  domain(pattern: string): this {
    for (const r of this.routes) r.domain = pattern;
    return this;
  }
}

function singular(s: string): string {
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.endsWith("s")) return s.slice(0, -1);
  return s;
}

/** RESTful resource routes; chain to trim, rename, or guard actions. */
export class RouteResource {
  constructor(
    private byAction: Map<string, RouteDefinition>,
    private resourceName: string,
    private child: string,
  ) {}

  only(actions: string[]): this {
    for (const [a, def] of this.byAction) if (!actions.includes(a)) def.methods = [];
    return this;
  }
  except(actions: string[]): this {
    for (const a of actions) {
      const def = this.byAction.get(a);
      if (def) def.methods = [];
    }
    return this;
  }
  /** Drop the HTML-form actions (create, edit). */
  apiOnly(): this {
    return this.except(["create", "edit"]);
  }

  /** Rename the route-name prefix, e.g. `.as("articles")` → `articles.index`. */
  as(name: string): this {
    for (const [action, def] of this.byAction) def.name = `${name}.${action}`;
    return this;
  }

  /** Rename a route parameter, e.g. `.params({ posts: "post" })`. */
  params(map: Record<string, string>): this {
    for (const [segment, newParam] of Object.entries(map)) {
      const oldParam =
        segment === this.child || segment === this.resourceName
          ? "id"
          : `${singular(segment)}_id`;
      for (const def of this.byAction.values()) {
        def.path = def.path.replace(`:${oldParam}`, `:${newParam}`);
      }
    }
    return this;
  }

  /** Attach middleware to specific actions (or "*" for all). */
  use(actions: string[] | "*", mw: MiddlewareRef | MiddlewareRef[]): this {
    const list = Array.isArray(mw) ? mw : [mw];
    for (const [action, def] of this.byAction) {
      if (actions === "*" || actions.includes(action)) def.middleware.push(...list);
    }
    return this;
  }
}

/** Fluent matcher for `on(path)` convenience routes. */
class RouteMatcher {
  constructor(private router: Router, private path: string) {}

  /** Redirect to a path or URL. */
  redirect(to: string, status = 302): Route {
    return this.router.get(this.path, () => makeRedirect(to, status));
  }
  /** Alias for redirect(), matching AdonisJS. */
  redirectToPath(to: string, status = 302): Route {
    return this.redirect(to, status);
  }

  /** Redirect to a named route, optionally with params and a query string. */
  redirectToRoute(
    name: string,
    params: Record<string, string | number> = {},
    options: { qs?: Record<string, string | number>; status?: number } = {},
  ): Route {
    return this.router.get(this.path, () => {
      let url = this.router.url(name, params);
      if (options.qs) {
        const qs = new URLSearchParams(
          Object.fromEntries(Object.entries(options.qs).map(([k, v]) => [k, String(v)])),
        );
        url += `?${qs}`;
      }
      return makeRedirect(url, options.status ?? 302);
    });
  }

  /** Render a view component directly. */
  render(component: (props?: any) => unknown, props?: any): Route {
    return this.router.get(this.path, () => view(component as never, props));
  }

  /** Render an Inertia page component directly. */
  renderInertia(component: string, props?: Record<string, unknown>): Route {
    return this.router.get(this.path, () => inertia(component, props));
  }
}

export class Router {
  private routes: RouteDefinition[] = [];
  private group_prefix = "";
  private group_mw: MiddlewareHandler[] = [];
  private globalWheres: Record<string, string> = {};
  private namedMiddleware: Record<string, MiddlewareHandler> = {};

  /** Built-in parameter matchers: `router.matchers.number()`. */
  readonly matchers = matchers;

  constructor(private container: Container) {}

  /**
   * Register named middleware, referenceable by name in `.middleware()` /
   * `.use()`: `router.named({ auth, admin })` then `route.use("auth")`.
   */
  named(map: Record<string, MiddlewareHandler>): this {
    Object.assign(this.namedMiddleware, map);
    return this;
  }

  /** Resolve a middleware reference (name or function) to a handler. */
  resolveMiddleware(ref: MiddlewareRef): MiddlewareHandler {
    if (typeof ref !== "string") return ref;
    const mw = this.namedMiddleware[ref];
    if (!mw) {
      throw new Error(
        `No named middleware [${ref}]. Register it with router.named({ ${ref}: … }).`,
      );
    }
    return mw;
  }

  get(path: string, handler: RouteHandler): Route {
    return this.add(["GET"], path, handler);
  }
  post(path: string, handler: RouteHandler): Route {
    return this.add(["POST"], path, handler);
  }
  put(path: string, handler: RouteHandler): Route {
    return this.add(["PUT"], path, handler);
  }
  patch(path: string, handler: RouteHandler): Route {
    return this.add(["PATCH"], path, handler);
  }
  delete(path: string, handler: RouteHandler): Route {
    return this.add(["DELETE"], path, handler);
  }
  /** Match any HTTP verb. */
  any(path: string, handler: RouteHandler): Route {
    return this.add(ALL, path, handler);
  }
  /** Match a specific set of verbs. */
  route(methods: Method[], path: string, handler: RouteHandler): Route {
    return this.add(methods, path, handler);
  }

  /** A fluent matcher: `router.on("/").redirect("/home")`. */
  on(path: string): RouteMatcher {
    return new RouteMatcher(this, path);
  }

  /**
   * Group routes under a shared prefix / middleware / name prefix:
   *   router.group(() => { … }).prefix("/api").middleware([auth]).as("api");
   */
  group(callback: () => void): RouteGroup {
    const start = this.routes.length;
    callback();
    return new RouteGroup(this.routes.slice(start));
  }

  /**
   * RESTful resource routes for a controller:
   *   index, create, store, show, edit, update, destroy.
   */
  resource(name: string, controller: ControllerRef): RouteResource {
    // Dotted names nest resources: "posts.comments" -> /posts/:post_id/comments.
    const segments = name.split(".");
    const child = segments.pop()!.replace(/^\/|\/$/g, "");
    let prefix = "";
    for (const seg of segments) {
      const s = seg.replace(/^\/|\/$/g, "");
      prefix += `/${s}/:${singular(s)}_id`;
    }
    const p = `${prefix}/${child}`;
    const id = `${p}/:id`;

    const defs = new Map<string, RouteDefinition>();
    const reg = (action: string, methods: Method[], path: string) => {
      const route = this.add(methods, path, [controller, action]);
      route.name(`${name}.${action}`);
      defs.set(action, route.def);
    };
    reg("index", ["GET"], p);
    reg("create", ["GET"], `${p}/create`);
    reg("store", ["POST"], p);
    reg("show", ["GET"], id);
    reg("edit", ["GET"], `${id}/edit`);
    reg("update", ["PUT", "PATCH"], id);
    reg("destroy", ["DELETE"], id);
    return new RouteResource(defs, name, child);
  }

  private add(methods: Method[], path: string, handler: RouteHandler): Route {
    const full = (this.group_prefix + "/" + path.replace(/^\//, "")).replace(/\/$/, "") || "/";
    const def: RouteDefinition = {
      methods,
      path: full,
      handler,
      middleware: [...this.group_mw],
      wheres: {},
    };
    this.routes.push(def);
    for (const hook of this.routeHooks) hook(def);
    return new Route(def);
  }

  private routeHooks: ((def: RouteDefinition) => void)[] = [];

  /**
   * Observe route registration — called with each route's definition as it's
   * added (and replayed for routes already registered). Handy for logging or
   * building an API map. The `def` is live, so reading it later reflects fluent
   * config (`.name()`, `.middleware()`) applied after registration.
   */
  onRoute(hook: (def: RouteDefinition) => void): this {
    for (const def of this.routes) hook(def);
    this.routeHooks.push(hook);
    return this;
  }

  /** Register a global parameter constraint, applied to every matching route. */
  where(param: string, matcher: Matcher): this {
    this.globalWheres[param] = matcherSource(matcher);
    return this;
  }

  /** All registered routes (excluding those trimmed to zero methods). */
  all(): RouteDefinition[] {
    for (const r of this.routes) {
      for (const [param, src] of Object.entries(this.globalWheres)) {
        if (!(param in r.wheres) && r.path.includes(`:${param}`)) {
          r.wheres[param] = src;
        }
      }
    }
    return this.routes.filter((r) => r.methods.length > 0);
  }

  /** Generate a URL for a named route, substituting `:params` and query string. */
  url(
    name: string,
    params: Record<string, string | number> = {},
    options: UrlOptions = {},
  ): string {
    const def = this.routes.find((r) => r.name === name);
    if (!def) throw new Error(`No route named [${name}].`);
    let path = def.path;
    for (const [k, v] of Object.entries(params)) {
      // Global + word-boundary: replace every `:k` occurrence, and don't let
      // `:id` match inside `:idx`.
      path = path.replace(new RegExp(`:${k}\\b\\??`, "g"), encodeURIComponent(String(v)));
    }
    path = path.replace(/\/:[^/]+\?/g, "").replace(/:[^/]+/g, "");
    if (options.qs && Object.keys(options.qs).length) {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(options.qs).map(([k, v]) => [k, String(v)])),
      );
      return `${path}?${qs}`;
    }
    return path;
  }

  /**
   * A tamper-proof URL for a named route, signed with `config('app.key')`.
   * Verify the incoming request with `router.hasValidSignature()`.
   */
  async signedUrl(
    name: string,
    params: Record<string, string | number> = {},
    options: SignedUrlOptions = {},
  ): Promise<string> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.qs ?? {})) qs.set(k, String(v));
    if (options.expiresIn) {
      qs.set("expires", String(Math.floor(Date.now() / 1000) + options.expiresIn));
    }
    let url = this.url(name, params);
    const query = qs.toString();
    if (query) url += `?${query}`;
    const signature = await hmac(appKey(), url);
    return `${url}${query ? "&" : "?"}signature=${signature}`;
  }

  /** Whether the current request carries a valid (unexpired) signature. */
  async hasValidSignature(): Promise<boolean> {
    const url = new URL(request.raw.url);
    const signature = url.searchParams.get("signature");
    if (!signature) return false;
    url.searchParams.delete("signature");

    const expires = url.searchParams.get("expires");
    if (expires && Number(expires) < Math.floor(Date.now() / 1000)) return false;

    const base = url.pathname + (url.search || "");
    const expected = await hmac(appKey(), base);
    return signature.length === expected.length && signature === expected;
  }

  /** Turn a route handler into an executable function, resolving controllers. */
  resolve(handler: RouteHandler): HandlerFn {
    if (handler instanceof Response) {
      const res = handler;
      return () => res.clone();
    }
    if (Array.isArray(handler)) {
      const [ref, method = "handle"] = handler as [ControllerRef, string?];
      const isLazy = !(ref as { prototype?: unknown }).prototype; // arrow = lazy loader
      return async (c: Ctx) => {
        let ctor = ref as Constructor;
        if (isLazy) {
          const mod = await (ref as LazyController)();
          ctor = ((mod as { default?: Constructor }).default ?? mod) as Constructor;
        }
        const controller = this.container.make(ctor) as Record<string, HandlerFn>;
        const action = controller[method];
        if (typeof action !== "function") {
          throw new Error(`Controller [${ctor.name}] has no method [${method}].`);
        }
        return action.call(controller, c);
      };
    }
    return handler;
  }
}
