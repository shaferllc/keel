/**
 * HTTP kernel. Owns the global middleware stack and compiles the Router's
 * collected routes onto a Hono instance that the server actually serves.
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Application } from "../application.js";
import { Router, type HandlerFn } from "./router.js";

export class HttpKernel {
  /** Global middleware, run on every request in order. */
  protected middleware: MiddlewareHandler[] = [];

  constructor(protected app: Application) {}

  use(mw: MiddlewareHandler): this {
    this.middleware.push(mw);
    return this;
  }

  /** Build the Hono app: bind container to context, apply middleware, mount routes. */
  build(): Hono {
    const hono = new Hono();
    const router = this.app.make(Router);

    // Make the container reachable from any handler via c.get("app").
    hono.use("*", async (c, next) => {
      c.set("app", this.app);
      await next();
    });

    for (const mw of this.middleware) {
      hono.use("*", mw);
    }

    for (const route of router.all()) {
      const fn: HandlerFn = router.resolve(route.handler);
      const honoHandler = async (c: any) => {
        const result = await fn(c);
        return typeof result === "string" ? c.html(result) : result;
      };

      switch (route.method) {
        case "GET": hono.get(route.path, honoHandler); break;
        case "POST": hono.post(route.path, honoHandler); break;
        case "PUT": hono.put(route.path, honoHandler); break;
        case "PATCH": hono.patch(route.path, honoHandler); break;
        case "DELETE": hono.delete(route.path, honoHandler); break;
        case "OPTIONS": hono.options(route.path, honoHandler); break;
      }
    }

    return hono;
  }
}
