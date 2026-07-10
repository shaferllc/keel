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

  /** The authenticated user's id, or null. */
  id(): string | null {
    return session().get<string | null>(KEY, null);
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
 * if `redirectTo` is set.
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
