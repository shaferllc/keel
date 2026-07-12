/**
 * Request decorators — attach named, computed values to the current request,
 * resolved lazily and memoized for the life of that request. You register a
 * resolver once, and Keel computes it on first access and caches it per request
 * (keyed off the Hono context via a WeakMap, so there's no shared-state leak
 * between requests and no V8 shape deopt to design around).
 *
 *   decorateRequest("user", async (c) => findUser(c.req.header("authorization")));
 *
 *   // anywhere in the request — computed once, then cached:
 *   const user = await decorated<User>("user");
 *
 * (Decorating the *application* is already the service container's job —
 * `bind` / `singleton` / `instance` / `make`, with `bound()` as `hasDecorator`.)
 */

import type { Context } from "hono";
import { ctx } from "./request.js";

/** Resolves a decorator's value from the current request context. */
export type RequestResolver<T = unknown> = (c: Context) => T | Promise<T>;

const resolvers = new Map<string, RequestResolver>();

// Per-request memo, keyed by the context object so it's GC'd with the request.
const memo = new WeakMap<Context, Map<string, unknown>>();

function bag(c: Context): Map<string, unknown> {
  let b = memo.get(c);
  if (!b) {
    b = new Map();
    memo.set(c, b);
  }
  return b;
}

/**
 * Register a request decorator. Throws if `name` is already registered.
 */
export function decorateRequest<T>(name: string, resolver: RequestResolver<T>): void {
  if (resolvers.has(name)) {
    throw new Error(`Request decorator "${name}" is already registered.`);
  }
  resolvers.set(name, resolver as RequestResolver);
}

/** Whether a request decorator has been registered. */
export function hasRequestDecorator(name: string): boolean {
  return resolvers.has(name);
}

/**
 * The value of a decorator for the current request — computed on first access
 * via its resolver, then cached for the rest of the request. Always returns a
 * promise (resolvers may be async).
 */
export function decorated<T = unknown>(name: string): Promise<T> {
  const c = ctx();
  const b = bag(c);
  if (b.has(name)) return Promise.resolve(b.get(name) as T);

  const resolver = resolvers.get(name);
  if (!resolver) {
    throw new Error(`No request decorator "${name}". Register it with decorateRequest().`);
  }
  // Memoize the promise so concurrent access computes once.
  const result = Promise.resolve(resolver(c));
  b.set(name, result);
  return result as Promise<T>;
}

/**
 * Imperatively set a decorator's value for the current request, overriding the
 * resolver — e.g. from an auth middleware that already resolved the user.
 */
export function setRequestValue<T>(name: string, value: T): void {
  bag(ctx()).set(name, value);
}

/** Clear all registered decorators (test helper). */
export function clearRequestDecorators(): void {
  resolvers.clear();
}
