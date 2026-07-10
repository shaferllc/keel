/**
 * Request validation. `validate()` parses input against a schema and returns
 * typed data, or throws a ValidationException (which the HTTP kernel renders as
 * a 422 with per-field errors).
 *
 * It is schema-library-agnostic: any schema with a Zod-style `safeParse` works
 * (Zod, and anything that mirrors its shape), so the framework never bundles a
 * validation library — bring your own.
 */

import { ValidationException } from "./exceptions.js";
import { body } from "./request.js";

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
