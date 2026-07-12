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

import type { Connection, Row, WriteResult, TransactionConnection } from "../core/database.js";

/** The slice of the node-postgres client API this adapter uses. */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  /**
   * Check a single connection out of the pool. Present on a `Pool`, absent on a
   * bare `Client` — which is exactly how this adapter tells the two apart.
   */
  connect?(): Promise<PgClientLike>;
}

/** A checked-out client. `release()` hands it back to the pool. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(): void;
}

function toWriteResult(result: { rows: Row[]; rowCount: number | null }): WriteResult {
  const insertId = result.rows?.[0]?.id as number | string | undefined;
  return { rowsAffected: result.rowCount ?? 0, insertId };
}

/** Build a `Connection` backed by a node-postgres-compatible client. */
export function pgConnection(client: PgLike): Connection {
  const conn: Connection = {
    async select(sql, bindings) {
      const { rows } = await client.query(sql, bindings);
      return rows;
    },
    async write(sql, bindings): Promise<WriteResult> {
      return toWriteResult(await client.query(sql, bindings));
    },
  };

  /**
   * A pool hands each statement to whichever connection is free, so running
   * `BEGIN` through it would wrap *nothing* — the INSERT after it could land on a
   * different connection entirely. So when the client can check one out, the
   * whole transaction runs on that single connection, and it goes back to the
   * pool afterwards whatever happens.
   *
   * A bare `Client` has no `connect()`, and doesn't need one: it *is* a single
   * connection. Keel falls back to BEGIN/COMMIT on it.
   */
  if (typeof client.connect === "function") {
    conn.begin = async (): Promise<TransactionConnection> => {
      const checkout = await client.connect!();
      await checkout.query("BEGIN");

      let done = false;
      const finish = async (sql: string): Promise<void> => {
        if (done) return;
        done = true;
        try {
          await checkout.query(sql);
        } finally {
          checkout.release(); // never leak the connection, even if COMMIT throws
        }
      };

      return {
        async select(sql, bindings) {
          const { rows } = await checkout.query(sql, bindings);
          return rows;
        },
        async write(sql, bindings) {
          return toWriteResult(await checkout.query(sql, bindings));
        },
        commit: () => finish("COMMIT"),
        rollback: () => finish("ROLLBACK"),
      };
    };
  }

  return conn;
}
