/**
 * A Keel `Connection` for Postgres. Pass any node-postgres-compatible client —
 * a `pg` `Pool`/`Client` on Node, or `@neondatabase/serverless` on the edge (both
 * expose the same `query(text, values)` API) — and register it with dialect
 * `"postgres"`:
 *
 *   import { pgConnection } from "@shaferllc/keel/db/pg";
 *   import { setConnection } from "@shaferllc/keel/core";
 *   import { Pool } from "pg"; // or "@neondatabase/serverless"
 *
 *   setConnection(pgConnection(new Pool({ connectionString })), "postgres");
 *
 * The client is duck-typed — this module imports no driver, so it works with
 * whichever Postgres client you install and never bundles one.
 *
 * Note on `insertId`: Postgres only returns an inserted row when the statement
 * has a `RETURNING` clause. This adapter surfaces `rows[0].id` when present;
 * otherwise `insertId` is `undefined` (so `insertGetId()` needs a `RETURNING id`).
 */

import type { Connection, Row, WriteResult } from "../core/database.js";

/** The slice of the node-postgres client API this adapter uses. */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

/** Build a `Connection` backed by a node-postgres-compatible client. */
export function pgConnection(client: PgLike): Connection {
  return {
    async select(sql, bindings) {
      const { rows } = await client.query(sql, bindings);
      return rows;
    },
    async write(sql, bindings): Promise<WriteResult> {
      const { rows, rowCount } = await client.query(sql, bindings);
      const insertId = rows?.[0]?.id as number | string | undefined;
      return { rowsAffected: rowCount ?? 0, insertId };
    },
  };
}
