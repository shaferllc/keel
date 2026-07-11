/**
 * Request validation. `validate()` parses input against a schema and returns
 * typed data, or throws a ValidationException (which the HTTP kernel renders as
 * a 422 with per-field errors).
 *
 * It is schema-library-agnostic: any schema with a Zod-style `safeParse` works
 * (Zod, and anything that mirrors its shape), so the framework never bundles a
 * validation library — bring your own.
 */

import type { Context, MiddlewareHandler } from "hono";
import { ValidationException } from "./exceptions.js";
import { body, ctx } from "./request.js";

/** The minimal shape Keel needs from a schema — Zod satisfies this. */
export interface Schema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
      };
}

/**
 * Validate `data` (or the request JSON body, if omitted) against a schema.
 * Returns the parsed, typed value; throws `ValidationException` on failure.
 *
 *   const data = await validate(NewUser);              // validates the body
 *   const q = validate(SearchQuery, request.query());  // validates given data
 */
export async function validate<T>(schema: Schema<T>, data?: unknown): Promise<T> {
  const input = data !== undefined ? data : await body();
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key =
      issue.path
        .map((p) => (typeof p === "symbol" ? (p.description ?? "") : String(p)))
        .join(".") || "_";
    (errors[key] ??= []).push(issue.message);
  }
  throw new ValidationException(errors);
}

/* ----------------------- declarative validation ---------------------------- */

/** Schemas to validate parts of the request against, before the handler runs. */
export interface RequestSchemas {
  body?: Schema<unknown>;
  query?: Schema<unknown>;
  params?: Schema<unknown>;
}

const validatedStore = new WeakMap<Context, Record<string, unknown>>();

function fieldKey(path: PropertyKey[]): string {
  return (
    path.map((p) => (typeof p === "symbol" ? (p.description ?? "") : String(p))).join(".") || "_"
  );
}

/**
 * Middleware that validates the request against `schemas` *before* the handler,
 * rejecting with a 422 `ValidationException` if any part fails (errors from all
 * parts are aggregated, keyed `body.field` / `query.field` / `params.field`).
 * On success the parsed, typed values are stashed for `validated()`.
 *
 *   router.post("/users", [Users, "store"]).middleware([validateRequest({ body: NewUser })]);
 *   // in the handler:
 *   const user = validated<NewUser>("body");
 */
export function validateRequest(schemas: RequestSchemas): MiddlewareHandler {
  return async (c, next) => {
    const parsed: Record<string, unknown> = {};
    const errors: Record<string, string[]> = {};

    const parts: [keyof RequestSchemas, () => unknown | Promise<unknown>][] = [
      ["body", () => body()],
      ["query", () => c.req.query()],
      ["params", () => c.req.param()],
    ];

    for (const [name, read] of parts) {
      const schema = schemas[name];
      if (!schema) continue;
      const result = schema.safeParse(await read());
      if (result.success) {
        parsed[name] = result.data;
      } else {
        for (const issue of result.error.issues) {
          (errors[`${name}.${fieldKey(issue.path)}`] ??= []).push(issue.message);
        }
      }
    }

    if (Object.keys(errors).length) throw new ValidationException(errors);
    validatedStore.set(c, parsed);
    await next();
  };
}

/** The validated, typed value for a request part (set by `validateRequest`). */
export function validated<T = unknown>(part: keyof RequestSchemas = "body"): T {
  const store = validatedStore.get(ctx());
  if (!store || !(part in store)) {
    throw new Error(`No validated "${part}". Add validateRequest({ ${part}: schema }) to the route.`);
  }
  return store[part] as T;
}
