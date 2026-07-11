// Type-check harness for docs/authentication.md. Every type-checkable snippet in
// the reference is exercised here against the real exports, so a renamed method
// or wrong argument type fails `npm run typecheck:docs`. Compile-only — never
// executed.
import type { MiddlewareHandler } from "hono";
import {
  Auth,
  auth,
  authGuard,
  setUserProvider,
  type UserProvider,
} from "@shaferllc/keel/core";

// Externals the snippets reference but the auth module doesn't own.
declare const db: {
  users: { find(id: number | string): Promise<{ id: number; email: string } | null> };
};
declare const userId: number;

export function provider() {
  setUserProvider((id) => db.users.find(id));
}

export async function readingUser() {
  auth().check();
  auth().guest();
  const uid: string | null = auth().id();
  const anyUser = await auth().user();

  type User = { id: number; email: string };
  const user = await auth().user<User>(); // User | null
  return { uid, anyUser, user };
}

export function loginLogout() {
  auth().login(userId);   // number
  auth().login("42");     // or string
  auth().logout();
}

export function guards() {
  const withRedirect: MiddlewareHandler = authGuard({ redirectTo: "/login" });
  const api: MiddlewareHandler = authGuard(); // 401 JSON, no redirect
  return { withRedirect, api };
}

export function directAuth() {
  if (new Auth().check()) {
    return new Auth().id();
  }
  return null;
}

// Interface / type seam: implement UserProvider, then register it.
const userProvider: UserProvider = async (id) => {
  // `id` is always a string; coerce if your keys are numeric.
  return db.users.find(Number(id));
};
setUserProvider(userProvider);

export { userProvider };
