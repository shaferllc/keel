/**
 * Sessions. A cookie-backed session store — no external service, so it works
 * the same on Node and the edge. Install `sessionMiddleware()` in your HTTP
 * kernel, then reach the session anywhere with `session()`.
 *
 *   session().put("userId", user.id);
 *   const id = session().get("userId");
 *   session().flash("status", "Saved!");   // available on the next request
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ctx } from "./request.js";
import { config } from "./helpers.js";
import { hmacHex, timingSafeEqual } from "./crypto.js";

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

/* -------------------------------- signing --------------------------------- */

/**
 * The whole session lives in the cookie, so the cookie is the only thing
 * stopping a visitor from simply declaring who they are. Base64 is an encoding,
 * not a secret: without a signature, `{"auth_id":"7"}` can be edited to
 * `{"auth_id":"1"}` and the server has no way to tell. So every cookie is
 * `payload.signature`, and a payload whose signature doesn't verify is not
 * "slightly wrong" — it is discarded entirely and the request starts with an
 * empty session.
 */
function sessionKey(): string {
  const key = config<string>("app.key", "");
  if (!key) {
    throw new Error(
      "Sessions require config('app.key') to sign the session cookie. Set APP_KEY " +
        "in your environment (the starter kits ship one in .env.example). Without a " +
        "key the cookie could not be signed, and an unsigned session cookie lets " +
        "anyone edit their own session — including who they are logged in as.",
    );
  }
  return key;
}

/** `payload.signature`, where the signature covers the exact payload string. */
async function sign(payload: string): Promise<string> {
  return `${payload}.${await hmacHex(payload, sessionKey())}`;
}

/** The payload of a correctly-signed cookie, or null for anything else. */
async function unsign(value: string): Promise<string | null> {
  // A legacy unsigned cookie has no separator and lands here as null — which is
  // the intended outcome. Everyone is logged out once on upgrade; the
  // alternative is honouring forgeable cookies forever.
  const split = value.lastIndexOf(".");
  if (split <= 0) return null;

  const payload = value.slice(0, split);
  const signature = value.slice(split + 1);
  const expected = await hmacHex(payload, sessionKey());

  return timingSafeEqual(signature, expected) ? payload : null;
}

/**
 * Whether this response should mark the cookie `Secure`. Inferred rather than
 * configured: defaulting it on would break every `http://localhost` dev server,
 * and defaulting it off is how a session cookie ends up crossing the public
 * internet in the clear. The forwarded header covers the usual production shape
 * — a proxy terminating TLS and speaking plain http to the app.
 */
function isSecureRequest(c: Context): boolean {
  const forwarded = c.req.header("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]!.trim() === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
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
    // Read the key before doing anything else, so a missing APP_KEY fails the
    // request outright rather than later, on the way out, once handlers have
    // already run and written to a session that can never be persisted.
    sessionKey();

    let data: SessionData = {};
    const raw = getCookie(c, name);
    if (raw) {
      const payload = await unsign(raw);
      if (payload !== null) {
        try {
          data = JSON.parse(b64decode(payload)) as SessionData;
        } catch {
          /* signed but not decodable — start fresh */
        }
      }
    }

    // Rotate flash: last request's flash becomes this request's "old".
    data[OLD] = data[FLASH] ?? {};
    delete data[FLASH];

    c.set("session", data);
    await next();

    const toStore: SessionData = { ...data };
    delete toStore[OLD];
    setCookie(c, name, await sign(b64encode(JSON.stringify(toStore))), {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      secure: isSecureRequest(c),
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
