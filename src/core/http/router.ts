/**
 * Router facade. Collects route definitions declaratively; the HTTP kernel
 * compiles them onto the underlying Hono instance at boot.
 *
 * Handlers are either a plain function or a [Controller, method] tuple that
 * gets resolved out of the container (so controllers have dependency injection).
 */

import type { Context as HonoContext } from "hono";
import type { Container, Constructor } from "../container.js";

/** The request context handed to every route handler and middleware. */
export type Ctx = HonoContext;

export type HandlerFn = (c: Ctx) => Response | Promise<Response> | string | Promise<string>;
export type ControllerAction = [Constructor, string];
/**
 * A route handler: a function, a [Controller, method] tuple, or a ready-made
 * Response for static routes — `router.get("/health", json({ ok: true }))`.
 */
export type RouteHandler = HandlerFn | ControllerAction | Response;

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface RouteDefinition {
  method: Method;
  path: string;
  handler: RouteHandler;
}

export class Router {
  private routes: RouteDefinition[] = [];

  constructor(private container: Container) {}

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }
  put(path: string, handler: RouteHandler): this {
    return this.add("PUT", path, handler);
  }
  patch(path: string, handler: RouteHandler): this {
    return this.add("PATCH", path, handler);
  }
  delete(path: string, handler: RouteHandler): this {
    return this.add("DELETE", path, handler);
  }

  private add(method: Method, path: string, handler: RouteHandler): this {
    this.routes.push({ method, path, handler });
    return this;
  }

  all(): RouteDefinition[] {
    return this.routes;
  }

  /** Turn a route handler into an executable function, resolving controllers. */
  resolve(handler: RouteHandler): HandlerFn {
    // A static Response (e.g. `json({ ok: true })`): clone it per request so
    // its body isn't consumed after the first response.
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
          throw new Error(
            `Controller [${ControllerClass.name}] has no method [${method}].`,
          );
        }
        return action.call(controller, c);
      };
    }
    return handler;
  }
}
