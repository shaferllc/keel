/**
 * Security headers — the "shield" for server-rendered apps. One middleware that
 * sets the defensive HTTP headers browsers act on: a Content-Security-Policy,
 * HSTS, clickjacking and MIME-sniffing guards, and a referrer policy.
 *
 *   this.use(securityHeaders());   // sensible defaults
 *
 *   this.use(securityHeaders({
 *     csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://cdn.example.com"] },
 *     hsts: { maxAge: 15552000, includeSubDomains: true },
 *     frameGuard: "DENY",
 *   }));
 *
 * Each header can be turned off with `false`. CSP takes a ready-made string or a
 * directives object whose camelCase keys become `kebab-case` (`defaultSrc` →
 * `default-src`). Pair with [`csrf()`](./csrf.ts) for form protection.
 */

import type { MiddlewareHandler } from "hono";

export interface HstsOptions {
  /** Max-age in seconds. Default 180 days. */
  maxAge?: number;
  /** Apply to subdomains too. Default true. */
  includeSubDomains?: boolean;
  /** Add `preload` (only if you've submitted to the HSTS preload list). Default false. */
  preload?: boolean;
}

export interface SecurityHeadersOptions {
  /** Content-Security-Policy — a raw string, a directives object, or `false` to omit. */
  csp?: string | Record<string, string[]> | false;
  /** Strict-Transport-Security. `true` for defaults, an object to tune, `false` to omit. Default off unless set. */
  hsts?: boolean | HstsOptions;
  /** X-Frame-Options clickjacking guard. Default `"SAMEORIGIN"`; `false` to omit. */
  frameGuard?: false | "DENY" | "SAMEORIGIN";
  /** X-Content-Type-Options: nosniff. Default true. */
  noSniff?: boolean;
  /** Referrer-Policy. Default `"strict-origin-when-cross-origin"`; `false` to omit. */
  referrerPolicy?: string | false;
}

/** camelCase directive names → the kebab-case CSP spelling. */
function buildCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => {
      const name = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return values.length ? `${name} ${values.join(" ")}` : name;
    })
    .join("; ");
}

export function securityHeaders(options: SecurityHeadersOptions = {}): MiddlewareHandler {
  const frame = options.frameGuard === undefined ? "SAMEORIGIN" : options.frameGuard;
  const referrer = options.referrerPolicy === undefined ? "strict-origin-when-cross-origin" : options.referrerPolicy;
  const noSniff = options.noSniff !== false;

  // Precompute the static header values once.
  const csp =
    options.csp === false || options.csp === undefined
      ? null
      : typeof options.csp === "string"
        ? options.csp
        : buildCsp(options.csp);

  let hstsValue: string | null = null;
  if (options.hsts) {
    const h = options.hsts === true ? {} : options.hsts;
    const parts = [`max-age=${h.maxAge ?? 15552000}`];
    if (h.includeSubDomains !== false) parts.push("includeSubDomains");
    if (h.preload) parts.push("preload");
    hstsValue = parts.join("; ");
  }

  return async (c, next) => {
    await next();
    if (csp) c.header("Content-Security-Policy", csp);
    if (hstsValue) c.header("Strict-Transport-Security", hstsValue);
    if (frame) c.header("X-Frame-Options", frame);
    if (noSniff) c.header("X-Content-Type-Options", "nosniff");
    if (referrer) c.header("Referrer-Policy", referrer);
  };
}
