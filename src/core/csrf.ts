/**
 * CSRF protection for server-rendered apps. A synchronizer token lives in the
 * session; state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) must echo it
 * back, or they're rejected with `419 Page Expired`. Needs `sessionMiddleware()`.
 *
 *   this.use(sessionMiddleware());
 *   this.use(csrf());
 *
 * Put the token in forms with `csrfField()`; SPAs get it for free — `csrf()` also
 * writes an `XSRF-TOKEN` cookie that axios/fetch libraries send back as the
 * `X-XSRF-TOKEN` header automatically. The token is also read from a `_token` or
 * `_csrf` field, or the `X-CSRF-Token` header.
 */

import type { Context, MiddlewareHandler } from "hono";
import { setCookie } from "hono/cookie";
import { HttpException } from "./exceptions.js";
import { session } from "./session.js";
import { request } from "./request.js";

const KEY = "_csrf";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** The current request's CSRF token, minting and storing one if absent. */
export function csrfToken(): string {
  const sess = session();
  let token = sess.get<string | undefined>(KEY, undefined);
  if (!token) {
    token = randomToken();
    sess.put(KEY, token);
  }
  return token;
}

/** A hidden form input carrying the CSRF token — drop it into any `<form method="POST">`. */
export function csrfField(): string {
  return `<input type="hidden" name="_token" value="${csrfToken()}">`;
}

async function submitted(c: Context): Promise<string | undefined> {
  const header = c.req.header("x-csrf-token") ?? c.req.header("x-xsrf-token");
  if (header) return header;
  const all = await request.all(); // shares keel's body cache — safe to read
  return (all._token ?? all._csrf) as string | undefined;
}

function isExcepted(path: string, except: (string | RegExp)[]): boolean {
  return except.some((rule) =>
    typeof rule === "string"
      ? rule.endsWith("*")
        ? path.startsWith(rule.slice(0, -1))
        : path === rule
      : rule.test(path),
  );
}

export interface CsrfOptions {
  /** Paths exempt from verification (webhooks, callbacks). Trailing `*` matches a prefix. */
  except?: (string | RegExp)[];
  /** Write the readable `XSRF-TOKEN` cookie for SPA libraries. Default true. */
  cookie?: boolean;
}

export function csrf(options: CsrfOptions = {}): MiddlewareHandler {
  const except = options.except ?? [];
  return async (c, next) => {
    const token = csrfToken(); // ensures a token exists in the session

    if (options.cookie !== false) {
      setCookie(c, "XSRF-TOKEN", token, { path: "/", sameSite: "Lax" }); // readable by JS on purpose
    }

    if (UNSAFE.has(c.req.method.toUpperCase()) && !isExcepted(c.req.path, except)) {
      const provided = await submitted(c);
      if (!provided || !safeEqual(provided, token)) {
        throw new HttpException(419, "CSRF token mismatch");
      }
    }
    await next();
  };
}
