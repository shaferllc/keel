/**
 * Route model binding — a `:user` in the path arrives as a `User`, not a string.
 *
 *   bindModel("user", User);
 *
 *   router.get("/users/:user", (c) => {
 *     const user = boundModel(User);   // already fetched. Not a string, not null.
 *     return c.json(user);
 *   });
 *
 * The row is looked up **before the handler runs**, and a miss is a 404 there and
 * then. That's the whole value: the handler never sees a null, so it never has to
 * remember to check for one — and "forgot the 404" stops being a bug you can write.
 *
 * Bind by another column when the URL isn't the id:
 *
 *   bindModel("post", Post, { key: "slug" });     // /posts/hello-world
 *
 * Constrain what's reachable (row-level security — a row outside the scope 404s,
 * so it can't be reached by guessing an id):
 *
 *   bindModel("post", Post, { scope: (q, c) => q.where("authorId", currentUserId(c)) });
 *
 * Or resolve it yourself, for anything that isn't a model:
 *
 *   bindRoute("tenant", (slug) => tenants.get(slug));
 */

import type { MiddlewareHandler } from "hono";

import type { Ctx } from "./http/router.js";
import type { QueryBuilder, Row } from "./database.js";
import type { Model } from "./model.js";
import { NotFoundException } from "./exceptions.js";
import { ctx } from "./request.js";

/** A `Model` subclass — the class itself, with its statics. */
export type ModelClass<T extends Model = Model> = {
  new (row?: Row): T;
  table: string;
  primaryKey: string;
  query(): QueryBuilder;
};

export interface BindingOptions<T extends Model = Model> {
  /** The column the URL segment matches. Default: the model's `primaryKey`. */
  key?: string;
  /**
   * Constrain what's findable. A row outside the scope is a 404 — so it can't be
   * reached by guessing an id, which is what makes this security rather than a
   * filter.
   */
  scope?: (query: QueryBuilder, c: Ctx) => QueryBuilder | void;
  /**
   * What to do when nothing matches. Default: throw a 404. Return a value to
   * substitute one instead.
   */
  missing?: (value: string, c: Ctx) => T | never;
}

interface Binding {
  /** The model this param resolves to, if it's a model binding. */
  model?: ModelClass;
  resolve: (value: string, c: Ctx) => unknown | Promise<unknown>;
}

const bindings = new Map<string, Binding>();

/**
 * Bind a route parameter to a model. `:user` becomes a `User`; a row that doesn't
 * exist (or is outside `scope`) is a 404 before your handler runs.
 */
export function bindModel<T extends Model>(
  param: string,
  model: ModelClass<T>,
  options: BindingOptions<T> = {},
): void {
  const column = options.key ?? model.primaryKey;

  bindings.set(param, {
    model: model as ModelClass,
    resolve: async (value, c) => {
      let query = model.query().where(column, value);
      if (options.scope) query = options.scope(query, c) ?? query;

      const row = await query.first();
      if (row) return new model(row);

      // A miss is a 404 *here*, not a null the handler has to remember to check.
      if (options.missing) return options.missing(value, c);
      throw new NotFoundException(`No ${model.name} for "${value}".`);
    },
  });
}

/**
 * Bind a route parameter to anything at all — a tenant from a map, a feature flag,
 * a value from an API. Returning `undefined` or `null` is a 404.
 */
export function bindRoute(
  param: string,
  resolve: (value: string, c: Ctx) => unknown | Promise<unknown>,
): void {
  bindings.set(param, {
    resolve: async (value, c) => {
      const resolved = await resolve(value, c);
      if (resolved === undefined || resolved === null) {
        throw new NotFoundException(`No match for "${value}".`);
      }
      return resolved;
    },
  });
}

/** Whether a parameter has a binding registered. */
export function hasBinding(param: string): boolean {
  return bindings.has(param);
}

/** Drop every binding — a clean slate between tests. */
export function clearBindings(): void {
  bindings.clear();
}

/** The parameter names in a route pattern: `/users/:user/posts/:post` → both. */
export function paramNames(pattern: string): string[] {
  return [...pattern.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
}

/**
 * Resolve this route's bound parameters and stash them on the request. Installed
 * by the HTTP kernel for any route whose pattern has a bound parameter — so the
 * work is skipped entirely for routes that don't.
 *
 * @internal
 */
export function resolveBindings(params: string[], c: Ctx): Promise<void> | void {
  const present = params.filter((p) => bindings.has(p));
  if (!present.length) return;

  return (async () => {
    const resolved: Record<string, unknown> = {};

    // In series, on purpose: a scoped binding usually depends on one resolved
    // before it (`/users/:user/posts/:post`, where the post is scoped to the user).
    for (const param of present) {
      const value = c.req.param(param);
      if (value === undefined) continue;
      resolved[param] = await bindings.get(param)!.resolve(value, c);
    }

    c.set("bindings", { ...c.get("bindings"), ...resolved });
  })();
}

/** Middleware that resolves the bound params of a route pattern. @internal */
export function bindingMiddleware(pattern: string): MiddlewareHandler | undefined {
  const params = paramNames(pattern);
  if (!params.length) return undefined;

  return async (c, next) => {
    await resolveBindings(params, c);
    await next();
  };
}

/* -------------------------------- accessors ------------------------------- */

/** The raw bound value for a parameter, if any. */
export function boundValue<T = unknown>(param: string, c?: Ctx): T | undefined {
  const store = (c ?? currentCtx())?.get("bindings");
  return store?.[param] as T | undefined;
}

/**
 * The model bound to this route — already fetched, never null.
 *
 *   router.get("/posts/:post", () => {
 *     const post = boundModel(Post);   // a Post, guaranteed
 *   });
 *
 * Pass the parameter name when one model is bound to several (`/users/:user/friends/:friend`).
 */
export function boundModel<T extends Model>(model: ModelClass<T>, param?: string, c?: Ctx): T {
  const ctx = c ?? currentCtx();
  const store = ctx?.get("bindings") ?? {};

  if (param) {
    const value = store[param];
    if (value === undefined) {
      throw new Error(
        `Nothing is bound to ":${param}". Register it with bindModel("${param}", ${model.name}).`,
      );
    }
    return value as T;
  }

  // No name given: find the one param bound to this model.
  const matches = Object.entries(store).filter(([name]) => bindings.get(name)?.model === model);

  if (!matches.length) {
    throw new Error(
      `No route parameter is bound to ${model.name}. Register one with bindModel("<param>", ${model.name}).`,
    );
  }
  if (matches.length > 1) {
    // Two params, same model — we can't guess which one you meant.
    throw new Error(
      `${matches.length} parameters are bound to ${model.name} (${matches.map(([n]) => `":${n}"`).join(", ")}). ` +
        `Say which: boundModel(${model.name}, "${matches[0]![0]}").`,
    );
  }

  return matches[0]![1] as T;
}

/** The request in scope, or undefined outside one. */
function currentCtx(): Ctx | undefined {
  try {
    return ctx();
  } catch {
    return undefined; // called outside a request
  }
}
