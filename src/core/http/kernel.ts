/**
 * HTTP kernel. Owns the global middleware stack, compiles the Router's
 * collected routes onto a Hono instance, and turns thrown errors (and
 * unmatched routes) into proper responses.
 */

import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import type { Context, MiddlewareHandler } from "hono";
import type { Application } from "../application.js";
import { Config } from "../config.js";
import {
  HttpException,
  NotFoundException,
  ValidationException,
  STATUS_TEXT,
} from "../exceptions.js";
import { Router, type HandlerFn } from "./router.js";

type ErrorHandler = (err: unknown, c: Context) => Response | Promise<Response>;

export class HttpKernel {
  /** Global middleware, run on every request in order. */
  protected middleware: MiddlewareHandler[] = [];

  /** Optional app-supplied error handler, taking precedence over the default. */
  protected customErrorHandler?: ErrorHandler;

  constructor(protected app: Application) {}

  use(mw: MiddlewareHandler): this {
    this.middleware.push(mw);
    return this;
  }

  /** Register a custom error handler (overrides the default rendering). */
  onError(handler: ErrorHandler): this {
    this.customErrorHandler = handler;
    return this;
  }

  /** Build the Hono app: bind container to context, apply middleware, mount routes. */
  build(): Hono {
    const hono = new Hono();
    const router = this.app.make(Router);

    // Store the context per-request so the request helpers (json, param, …)
    // can reach it without being handed `c`.
    hono.use("*", contextStorage());

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
      const honoHandler = async (c: Context) => {
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

    // Unmatched routes and thrown errors both flow through the handler.
    hono.notFound((c) =>
      this.handle(new NotFoundException(`No route for ${c.req.method} ${c.req.path}`), c),
    );
    hono.onError((err, c) => this.handle(err, c));

    return hono;
  }

  private handle(err: unknown, c: Context): Response | Promise<Response> {
    if (this.customErrorHandler) return this.customErrorHandler(err, c);
    return this.renderException(err, c);
  }

  /** Default rendering: HTML for browsers, JSON otherwise; details in debug. */
  protected renderException(err: unknown, c: Context): Response {
    const isHttp = err instanceof HttpException;
    const status = isHttp ? err.status : 500;
    const debug = Boolean(this.app.make(Config).get("app.debug", false));
    const title = STATUS_TEXT[status] ?? "Error";

    // Hide internal messages for unexpected 500s in production.
    const message =
      isHttp || debug ? (err instanceof Error ? err.message : String(err)) : title;

    if (isHttp && err.headers) {
      for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
    }

    const wantsHtml = (c.req.header("accept") ?? "").includes("text/html");
    const code = status as 400;

    if (wantsHtml) {
      return c.html(this.errorPage(status, title, message, err, debug, c), code);
    }

    const body: Record<string, unknown> = { error: message, status };
    if (err instanceof ValidationException) body.errors = err.errors;
    if (debug && !isHttp && err instanceof Error) {
      body.exception = err.name;
      body.stack = (err.stack ?? "").split("\n").map((l) => l.trim());
    }
    return c.json(body, code);
  }

  private errorPage(
    status: number,
    title: string,
    message: string,
    err: unknown,
    debug: boolean,
    c: Context,
  ): string {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const stack = debug && err instanceof Error && err.stack ? esc(err.stack) : "";
    const req = `${c.req.method} ${c.req.path}`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} ${esc(title)}</title><style>
  body{margin:0;background:#0b1120;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:2rem}
  .box{max-width:52rem;width:100%}
  .status{font-size:4rem;font-weight:700;line-height:1;color:#f87171}
  .title{font-size:1.1rem;color:#94a3b8;margin:.3rem 0 1.2rem;text-transform:uppercase;letter-spacing:.1em}
  .msg{font-size:1.25rem;margin:0 0 1rem}
  .req{color:#64748b;font-size:.9rem;margin-bottom:1.5rem}
  pre{background:#020617;border:1px solid #1e293b;border-radius:.5rem;padding:1.1rem;overflow-x:auto;font-size:.82rem;line-height:1.7;color:#cbd5e1;white-space:pre-wrap}
</style></head><body><div class="box">
  <div class="status">${status}</div>
  <div class="title">${esc(title)}</div>
  <p class="msg">${esc(message)}</p>
  <div class="req">${esc(req)}</div>
  ${stack ? `<pre>${stack}</pre>` : ""}
</div></body></html>`;
  }
}
