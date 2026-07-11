/**
 * Session-based authentication. Builds on the session store — `login()` stashes
 * the user id in the session, `user()` loads the full user through a provider
 * you register. Pair it with `hash` for password checks.
 *
 *   const user = await findUserByEmail(email);
 *   if (user && (await hash.verify(user.password, password))) {
 *     auth().login(user.id);
 *   }
 *
 *   auth().check();          // logged in?
 *   await auth().user();      // the full user (via your provider)
 */

import type { MiddlewareHandler } from "hono";
import { session } from "./session.js";
import { ctx } from "./request.js";
import { jwt } from "./crypto.js";

const KEY = "auth_id";

/** Loads a user by the id stored in the session. Register with setUserProvider. */
export type UserProvider = (id: string) => unknown | Promise<unknown>;
let provider: UserProvider | undefined;

/** Tell Keel how to load the authenticated user from its id. */
export function setUserProvider(fn: UserProvider): void {
  provider = fn;
}

export class Auth {
  /** Log a user in by id (stored in the session). */
  login(id: string | number): void {
    session().put(KEY, String(id));
  }

  /** Log the current user out. */
  logout(): void {
    session().forget(KEY);
  }

  /**
   * The authenticated user's id, or null. A token verified by `bearerAuth()`
   * wins; otherwise it falls back to the session (set via `login()`). Reads the
   * request context directly so token-only APIs work without a session store.
   */
  id(): string | null {
    const fromToken = ctx().get("auth_id");
    if (fromToken != null) return String(fromToken);
    const data = ctx().get("session") as Record<string, unknown> | undefined;
    return data && data[KEY] != null ? String(data[KEY]) : null;
  }

  /** Whether a user is authenticated. */
  check(): boolean {
    return this.id() != null;
  }

  /** Whether the request is unauthenticated. */
  guest(): boolean {
    return !this.check();
  }

  /** Load the authenticated user via the registered provider. */
  async user<User = unknown>(): Promise<User | null> {
    const id = this.id();
    if (id == null) return null;
    if (!provider) {
      throw new Error("No user provider. Call setUserProvider((id) => findUser(id)).");
    }
    return (await provider(id)) as User | null;
  }
}

/** The auth accessor for the current request. */
export function auth(): Auth {
  return new Auth();
}

/**
 * A guard middleware: rejects unauthenticated requests with a 401, or redirects
 * if `redirectTo` is set. Honors both session logins and a `bearerAuth()` token.
 */
export function authGuard(options: { redirectTo?: string } = {}): MiddlewareHandler {
  return async (c, next) => {
    if (new Auth().guest()) {
      if (options.redirectTo) return c.redirect(options.redirectTo);
      return c.json({ error: "Unauthenticated", status: 401 }, 401);
    }
    await next();
  };
}

/**
 * Token (API) auth: read a `Bearer` JWT from the `Authorization` header, verify
 * it, and make its `sub` the authenticated user id — so `auth().user()` resolves
 * through your registered provider, exactly as with session auth. Issue the
 * token in your login handler with `jwt.sign({ sub: String(user.id) }, …)`.
 *
 *   router.get("/api/me", bearerAuth(), async () => json(await auth().user()));
 *
 * Rejects a missing or invalid token with a 401. Pass `{ optional: true }` to
 * let the request through unauthenticated (e.g. content that varies by login
 * but doesn't require it) — `auth().check()` is then false downstream.
 */
export function bearerAuth(options: { optional?: boolean } = {}): MiddlewareHandler {
  return async (c, next) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const payload = token ? await jwt.verify(token) : null;
    if (!payload || payload.sub == null) {
      if (options.optional) return next();
      return c.json({ error: "Unauthenticated", status: 401 }, 401);
    }
    c.set("auth_id", String(payload.sub));
    await next();
  };
}
