/**
 * Attribute casting for models. A model's `static casts` maps columns to a type;
 * values are cast to real JS types when read (from the database or `fill`) and
 * back to storable primitives when written. This is what lets a `boolean` column
 * round-trip as `true`/`false` (not `1`/`0`) and a `json` column as an object.
 *
 *   class User extends Model {
 *     static casts = { active: "boolean", meta: "json", joined_at: "date" };
 *   }
 */

import type { Row } from "./database.js";

export type CastType =
  | "int"
  | "integer"
  | "float"
  | "number"
  | "boolean"
  | "bool"
  | "string"
  | "json"
  | "array"
  | "date";

export type Casts = Record<string, CastType>;

/** Raw storage value -> JS value. Tolerant of already-cast input. */
export function castGet(value: unknown, type: CastType): unknown {
  if (value === null || value === undefined) return value;
  switch (type) {
    case "int":
    case "integer":
      return Math.trunc(Number(value));
    case "float":
    case "number":
      return Number(value);
    case "boolean":
    case "bool":
      return value === true || value === 1 || value === "1" || value === "true";
    case "string":
      return String(value);
    case "json":
    case "array":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "date":
      return value instanceof Date ? value : new Date(value as string | number);
    default:
      return value;
  }
}

/** JS value -> storable primitive (numbers, strings, 0/1, null). */
export function castSet(value: unknown, type: CastType): unknown {
  if (value === null || value === undefined) return value;
  switch (type) {
    case "int":
    case "integer":
      return Math.trunc(Number(value));
    case "float":
    case "number":
      return Number(value);
    case "boolean":
    case "bool":
      return value ? 1 : 0;
    case "string":
      return String(value);
    case "json":
    case "array":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "date":
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

/** Apply a caster to just the keys named in `casts`, leaving the rest as-is. */
export function applyCasts(
  row: Row,
  casts: Casts,
  caster: (value: unknown, type: CastType) => unknown,
): Row {
  const out: Row = { ...row };
  for (const [key, type] of Object.entries(casts)) {
    if (key in out) out[key] = caster(out[key], type);
  }
  return out;
}
