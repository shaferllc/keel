/**
 * Schema conversion. A route documents itself with the same Zod schemas it
 * validates with; the spec needs JSON Schema. Zod 4 ships that conversion
 * (`z.toJSONSchema`), so this is a thin, defensive wrapper: Zod schemas are
 * converted (targeting OpenAPI 3.0's dialect), plain JSON Schema objects pass
 * through untouched, and anything unrecognized yields `undefined` rather than
 * throwing — a missing schema shouldn't sink the whole document.
 */

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/** Duck-type a Zod (or Zod-like) schema. */
function isZod(value: unknown): boolean {
  return (
    !!value &&
    typeof (value as { parse?: unknown }).parse === "function" &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/** A value that already looks like a JSON Schema (or a `$ref`). */
function isJsonSchema(value: unknown): value is JsonSchema {
  if (!value || typeof value !== "object" || isZod(value)) return false;
  const keys = ["type", "$ref", "properties", "items", "oneOf", "anyOf", "allOf", "enum"];
  return keys.some((k) => k in (value as object));
}

/** Convert a Zod schema or JSON Schema to an OpenAPI-flavoured JSON Schema. */
export function toJsonSchema(schema: unknown): JsonSchema | undefined {
  if (!schema) return undefined;
  if (isJsonSchema(schema)) return schema;
  if (!isZod(schema)) return undefined;

  const convert = z.toJSONSchema as ((s: unknown, opts?: unknown) => JsonSchema) | undefined;
  if (typeof convert !== "function") return undefined;
  try {
    // OpenAPI 3.0 uses `nullable` and a few other divergences from raw JSON Schema.
    return convert(schema, { target: "openapi-3.0", io: "input" });
  } catch {
    try {
      return convert(schema);
    } catch {
      return undefined;
    }
  }
}
