/**
 * Sessions. A cookie-backed session store — no external service, so it works
 * the same on Node and the edge. Install `sessionMiddleware()` in your HTTP
 * kernel, then reach the session anywhere with `session()`.
 *
 *   session().put("userId", user.id);
 *   const id = session().get("userId");
 *   session().flash("status", "Saved!");   // available on the next request
 */

import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ctx } from "./request.js";

type SessionData = Record<string, unknown>;
type CookieOptions = Parameters<typeof setCookie>[3];

const FLASH = "__flash";
const OLD = "__old";

/** UTF-8-safe base64 — plain btoa throws on non-Latin1 (emoji, many scripts). */
function b64encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(raw: string): string {
  const s = atob(raw);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class Session {
  constructor(private data: SessionData) {}

  /** Everything in the session (excluding internal flash keys). */
  all(): SessionData {
    const { [FLASH]: _f, [OLD]: _o, ...rest } = this.data;
    return rest;
  }

  get<T = unknown>(key: string, fallback?: T): T {
    return (key in this.data ? (this.data[key] as T) : (fallback as T));
  }

  put(key: string, value: unknown): this {
    this.data[key] = value;
    return this;
  }
  /** Alias for put(). */
  set(key: string, value: unknown): this {
    return this.put(key, value);
  }

  has(key: string): boolean {
    return key in this.data && this.data[key] != null;
  }

  forget(key: string): this {
    delete this.data[key];
    return this;
  }

  /** Read and remove a value. */
  pull<T = unknown>(key: string, fallback?: T): T {
    const value = this.get(key, fallback);
    this.forget(key);
    return value;
  }

  increment(key: string, by = 1): this {
    this.data[key] = ((this.data[key] as number) ?? 0) + by;
    return this;
  }
  decrement(key: string, by = 1): this {
    return this.increment(key, -by);
  }

  clear(): this {
    for (const key of Object.keys(this.data)) delete this.data[key];
    return this;
  }

  /** Flash a value for the next request only. */
  flash(key: string, value: unknown): this {
    const flash = (this.data[FLASH] as SessionData) ?? {};
    flash[key] = value;
    this.data[FLASH] = flash;
    return this;
  }

  /** Read a value flashed on the previous request. */
  flashed<T = unknown>(key: string, fallback?: T): T {
    const old = (this.data[OLD] as SessionData) ?? {};
    return (key in old ? (old[key] as T) : (fallback as T));
  }
}

export interface SessionOptions {
  cookieName?: string;
  cookie?: CookieOptions;
}

/**
 * Loads the session from its cookie before the request and writes it back
 * after. Register it in your HTTP kernel with `this.use(sessionMiddleware())`.
 */
export function sessionMiddleware(options: SessionOptions = {}): MiddlewareHandler {
  const name = options.cookieName ?? "keel_session";
  return async (c, next) => {
    let data: SessionData = {};
    const raw = getCookie(c, name);
    if (raw) {
      try {
        data = JSON.parse(b64decode(raw)) as SessionData;
      } catch {
        /* tampered/expired — start fresh */
      }
    }

    // Rotate flash: last request's flash becomes this request's "old".
    data[OLD] = data[FLASH] ?? {};
    delete data[FLASH];

    c.set("session", data);
    await next();

    const toStore: SessionData = { ...data };
    delete toStore[OLD];
    setCookie(c, name, b64encode(JSON.stringify(toStore)), {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      ...options.cookie,
    });
  };
}

/** The current request's session. Requires `sessionMiddleware()` installed. */
export function session(): Session {
  const data = ctx().get("session");
  if (!data) {
    throw new Error(
      "Session is not available. Add sessionMiddleware() to your HTTP kernel.",
    );
  }
  return new Session(data);
}
