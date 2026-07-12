/**
 * Turn the query string of a list request into filters, sorting, and a page —
 * safely. The cardinal rule of an auto-generated API: **never** let the client
 * filter or sort by an arbitrary column. Everything here is checked against an
 * allow-list; anything not on it is silently ignored, not passed to SQL. That's
 * what keeps `?password=…` or `?sort=secret_column` from doing anything.
 */

import type { Ctx } from "../core/http/router.js";
import type { QueryBuilder } from "../core/database.js";

export interface ListQueryOptions {
  /** Columns a client may filter on (`?status=published`). */
  filter: string[];
  /** Columns a client may sort by (`?sort=title,-createdAt`). */
  sort: string[];
  /** Default page size. */
  perPage: number;
  /** Maximum `?perPage=`. */
  maxPerPage: number;
}

export interface ListParams {
  page: number;
  perPage: number;
  filters: Array<{ column: string; value: string }>;
  sort: Array<{ column: string; direction: "asc" | "desc" }>;
}

/** Query keys that control pagination/sorting, never treated as filters. */
const RESERVED = new Set(["page", "perPage", "per_page", "sort", "q", "limit", "offset"]);

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Parse (and allow-list) the list query params. */
export function parseListParams(c: Ctx, opts: ListQueryOptions): ListParams {
  const q = c.req.query() as Record<string, string>;

  const page = Math.max(1, toInt(q.page, 1));
  const perPage = Math.min(Math.max(1, toInt(q.perPage ?? q.per_page, opts.perPage)), opts.maxPerPage);

  const allowFilter = new Set(opts.filter);
  const filters = Object.entries(q)
    .filter(([key]) => !RESERVED.has(key) && allowFilter.has(key))
    .map(([column, value]) => ({ column, value }));

  const allowSort = new Set(opts.sort);
  const sort = (q.sort ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith("-")
        ? { column: s.slice(1), direction: "desc" as const }
        : { column: s, direction: "asc" as const },
    )
    .filter((s) => allowSort.has(s.column));

  return { page, perPage, filters, sort };
}

/** Apply parsed filters and sorting to a query builder. */
export function applyListParams(query: QueryBuilder, params: ListParams): QueryBuilder {
  let q = query;
  for (const f of params.filters) q = q.where(f.column, f.value);
  for (const s of params.sort) q = q.orderBy(s.column, s.direction);
  return q;
}
