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
import { Router, type HandlerFn, type RouteDefinition } from "./router.js";

type ErrorHandler = (err: unknown, c: Context) => Response | Promise<Response>;

/** Per-request stash of subdomain params, keyed by the raw Request. */
const SUBDOMAINS = new WeakMap<Request, Record<string, string>>();

/** Compile a host pattern like ":tenant.example.com" into a matcher. */
function domainMatcher(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split(".")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^.]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("\\.");
  return { regex: new RegExp(`^${source}$`), keys };
}

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

  /** Build the Hono app: mount routes, dispatch domain routes by host. */
  build(): Hono {
    const router = this.app.make(Router);
    const routes = router.all();
    const domainRoutes = routes.filter((r) => r.domain);
    const defaultRoutes = routes.filter((r) => !r.domain);

    // No domain routing — the common case.
    if (domainRoutes.length === 0) {
      return this.compile(defaultRoutes);
    }

    // Compile a Hono per distinct host pattern, plus a host dispatcher that
    // runs before everything else on the default app.
    const byDomain = new Map<string, RouteDefinition[]>();
    for (const r of domainRoutes) {
      const list = byDomain.get(r.domain!) ?? [];
      list.push(r);
      byDomain.set(r.domain!, list);
    }
    const compiled = [...byDomain.entries()].map(([pattern, rs]) => ({
      ...domainMatcher(pattern),
      hono: this.compile(rs),
    }));

    const dispatch: MiddlewareHandler = async (c, next) => {
      const host = (c.req.header("host") ?? "").split(":")[0]!;
      for (const d of compiled) {
        const m = host.match(d.regex);
        if (m) {
          const subs: Record<string, string> = {};
          d.keys.forEach((k, i) => (subs[k] = m[i + 1]!));
          SUBDOMAINS.set(c.req.raw, subs);
          return d.hono.fetch(c.req.raw, c.env);
        }
      }
      await next();
    };

    return this.compile(defaultRoutes, dispatch);
  }

  /** Compile a set of routes onto a fresh Hono instance. */
  private compile(routes: RouteDefinition[], firstMiddleware?: MiddlewareHandler): Hono {
    const hono = new Hono();
    const router = this.app.make(Router);

    if (firstMiddleware) hono.use("*", firstMiddleware);

    // Store the context per-request so the request helpers reach it.
    hono.use("*", contextStorage());

    // Bind the container and any subdomain params onto the context.
    hono.use("*", async (c, next) => {
      c.set("app", this.app);
      const subs = SUBDOMAINS.get(c.req.raw);
      if (subs) c.set("subdomains", subs);
      await next();
    });

    for (const mw of this.middleware) {
      hono.use("*", mw);
    }

    for (const route of routes) {
      const fn: HandlerFn = router.resolve(route.handler);
      const honoHandler = async (c: Context) => {
        c.set("route", { name: route.name, pattern: route.path, methods: route.methods });
        const result = await fn(c);
        return typeof result === "string" ? c.html(result) : result;
      };

      // Compile param constraints into Hono's regex-param syntax (:id{\d+}).
      let path = route.path;
      for (const [param, rgx] of Object.entries(route.wheres)) {
        path = path.replace(new RegExp(`:${param}(\\??)`), `:${param}{${rgx}}$1`);
      }

      const middleware = route.middleware.map((m) => router.resolveMiddleware(m));
      hono.on(route.methods, [path], ...middleware, honoHandler);
    }

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
