/**
 * CORS — Cross-Origin Resource Sharing. Register it in your HTTP kernel (or on a
 * route group) to let browsers on other origins call your API. It answers
 * preflight `OPTIONS` requests automatically and sets the `Access-Control-*`
 * headers on every response.
 *
 *   this.use(cors());                                  // reflect any origin (dev)
 *   this.use(cors({ origin: ["https://app.example.com"], credentials: true }));
 *
 * `origin` accepts a boolean (`true` reflects the caller, `false` blocks), `"*"`,
 * an allowlist array, or a predicate. When `credentials` is on, `"*"` isn't legal
 * per the spec, so the caller's origin is reflected and `Vary: Origin` is set.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface CorsOptions {
  /** Who may call: `true` reflects the request origin, `false` blocks, `"*"` any, an allowlist, or a predicate. Default `true`. */
  origin?: boolean | string | string[] | ((origin: string, c: Context) => boolean | string);
  /** Allowed methods for cross-origin requests. */
  methods?: string[];
  /** Allowed request headers: `true` reflects what the browser asks for, or an allowlist. Default `true`. */
  headers?: boolean | string[];
  /** Response headers JS may read (`Access-Control-Expose-Headers`). */
  exposeHeaders?: string[];
  /** Send `Access-Control-Allow-Credentials: true` (cookies/authorization). Default `false`. */
  credentials?: boolean;
  /** Preflight cache seconds (`Access-Control-Max-Age`). `null` omits it. Default 86400. */
  maxAge?: number | null;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

/** Resolve the allowed origin for this request, or `null` to disallow. */
function resolveOrigin(
  option: CorsOptions["origin"],
  requestOrigin: string,
  c: Context,
): string | null {
  if (option === undefined || option === true) return requestOrigin || "*";
  if (option === false) return null;
  if (option === "*") return "*";
  if (typeof option === "string") return option;
  if (Array.isArray(option)) return option.includes(requestOrigin) ? requestOrigin : null;
  const result = option(requestOrigin, c);
  if (result === true) return requestOrigin || "*";
  if (result === false) return null;
  return result;
}

export function cors(options: CorsOptions = {}): MiddlewareHandler {
  const methods = options.methods ?? DEFAULT_METHODS;
  const maxAge = options.maxAge === undefined ? 86400 : options.maxAge;
  const credentials = options.credentials ?? false;

  return async (c, next) => {
    const requestOrigin = c.req.header("origin") ?? "";
    let allowOrigin = resolveOrigin(options.origin, requestOrigin, c);

    // With credentials, "*" is illegal — reflect the concrete origin instead.
    if (allowOrigin === "*" && credentials) allowOrigin = requestOrigin || null;

    const shared: Record<string, string> = {};
    if (allowOrigin) shared["Access-Control-Allow-Origin"] = allowOrigin;
    // Reflecting a specific origin makes the response vary by it (caches).
    if (allowOrigin && allowOrigin !== "*") shared["Vary"] = "Origin";
    if (credentials) shared["Access-Control-Allow-Credentials"] = "true";

    // Preflight — answer directly with all headers, never reaching the route.
    if (c.req.method === "OPTIONS" && c.req.header("access-control-request-method")) {
      const headers: Record<string, string> = { ...shared, "Access-Control-Allow-Methods": methods.join(", ") };
      const allowHeaders =
        options.headers === undefined || options.headers === true
          ? c.req.header("access-control-request-headers") ?? ""
          : (options.headers as string[]).join(", ");
      if (allowHeaders) headers["Access-Control-Allow-Headers"] = allowHeaders;
      if (maxAge != null) headers["Access-Control-Max-Age"] = String(maxAge);
      return c.body(null, 204, headers);
    }

    await next();
    // Set on the final response (survives a handler that returns a fresh Response).
    for (const [name, value] of Object.entries(shared)) c.header(name, value);
    if (options.exposeHeaders?.length) {
      c.header("Access-Control-Expose-Headers", options.exposeHeaders.join(", "));
    }
  };
}
