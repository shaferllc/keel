/**
 * Router facade. Collects route definitions declaratively; the HTTP kernel
 * compiles them onto the underlying Hono instance at boot.
 *
 * Fluent, AdonisJS-inspired API: named routes, per-route and group middleware,
 * prefixes, param constraints, resource routes, and URL generation.
 */

import type { Context as HonoContext, MiddlewareHandler } from "hono";
import type { Container, Constructor } from "../container.js";
import { view } from "../helpers.js";
import { redirect as makeRedirect } from "../request.js";

/** The request context handed to every route handler and middleware. */
export type Ctx = HonoContext;

export type HandlerFn = (c: Ctx) => Response | Promise<Response> | string | Promise<string>;
export type ControllerAction = [Constructor, string];
/** A function, a [Controller, method] tuple, or a ready-made Response. */
export type RouteHandler = HandlerFn | ControllerAction | Response;

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
const ALL: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

export interface RouteDefinition {
  methods: Method[];
  path: string;
  handler: RouteHandler;
  name?: string;
  middleware: MiddlewareHandler[];
  wheres: Record<string, string>;
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
  middleware(mw: MiddlewareHandler | MiddlewareHandler[]): this {
    this.def.middleware.push(...(Array.isArray(mw) ? mw : [mw]));
    return this;
  }

  /** Constrain a route parameter with a regular expression. */
  where(param: string, matcher: RegExp | string): this {
    this.def.wheres[param] = matcher instanceof RegExp ? matcher.source : matcher;
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

  middleware(mw: MiddlewareHandler | MiddlewareHandler[]): this {
    const list = Array.isArray(mw) ? mw : [mw];
    for (const r of this.routes) r.middleware.unshift(...list); // group runs first
    return this;
  }

  as(namePrefix: string): this {
    for (const r of this.routes) if (r.name) r.name = `${namePrefix}.${r.name}`;
    return this;
  }
}

/** RESTful resource routes; chain to trim the action set. */
export class RouteResource {
  constructor(private byAction: Map<string, RouteDefinition>) {}

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
}

/** Fluent matcher for `on(path)` convenience routes. */
class RouteMatcher {
  constructor(private router: Router, private path: string) {}

  redirect(to: string, status = 302): Route {
    return this.router.get(this.path, () => makeRedirect(to, status));
  }

  render(component: (props?: any) => unknown, props?: any): Route {
    return this.router.get(this.path, () => view(component as never, props));
  }
}

export class Router {
  private routes: RouteDefinition[] = [];
  private group_prefix = "";
  private group_mw: MiddlewareHandler[] = [];

  constructor(private container: Container) {}

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
  resource(name: string, controller: Constructor): RouteResource {
    const base = "/" + name.replace(/^\/|\/$/g, "");
    const p = base;
    const id = `${base}/:id`;
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
    return new RouteResource(defs);
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
    return new Route(def);
  }

  /** All registered routes (excluding those trimmed to zero methods). */
  all(): RouteDefinition[] {
    return this.routes.filter((r) => r.methods.length > 0);
  }

  /** Generate a URL for a named route, substituting `:params`. */
  url(name: string, params: Record<string, string | number> = {}): string {
    const def = this.routes.find((r) => r.name === name);
    if (!def) throw new Error(`No route named [${name}].`);
    let path = def.path;
    for (const [k, v] of Object.entries(params)) {
      path = path.replace(new RegExp(`:${k}\\??`), encodeURIComponent(String(v)));
    }
    return path.replace(/\/:[^/]+\?/g, "").replace(/:[^/]+/g, "");
  }

  /** Turn a route handler into an executable function, resolving controllers. */
  resolve(handler: RouteHandler): HandlerFn {
    if (handler instanceof Response) {
      const res = handler;
      return () => res.clone();
    }
    if (Array.isArray(handler)) {
      const [ControllerClass, method] = handler;
      return (c: Ctx) => {
        const controller = this.container.make(ControllerClass) as Record<string, HandlerFn>;
        const action = controller[method];
        if (typeof action !== "function") {
          throw new Error(`Controller [${ControllerClass.name}] has no method [${method}].`);
        }
        return action.call(controller, c);
      };
    }
    return handler;
  }
}
