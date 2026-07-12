/**
 * A Keel `Connection` for libSQL / Turso. Pass an `@libsql/client` client (it
 * runs on Node and the edge — Turso speaks HTTP) and register it with dialect
 * `"sqlite"`:
 *
 *   import { libsqlConnection } from "@shaferllc/keel/db/libsql";
 *   import { setConnection } from "@shaferllc/keel/core";
 *   import { createClient } from "@libsql/client";
 *
 *   const client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
 *   setConnection(libsqlConnection(client), "sqlite");
 *
 * The client is duck-typed — this module imports no driver, so it never bundles
 * `@libsql/client`.
 */

import type { Connection, Row, WriteResult } from "../core/database.js";

/** The slice of the `@libsql/client` API this adapter uses. */
export interface LibSqlLike {
  /**
   * `any` rather than `unknown[]` / `Row[]` on purpose.
   *
   * The official client types its arguments as `InArgs` and its rows as its own
   * `Row`, and under `strictFunctionTypes` a narrower parameter type makes the real
   * `Client` *unassignable* to this interface — so wiring libSQL the obvious way
   * required `client as unknown as LibSqlLike`, which is a cast a user shouldn't
   * have to discover. Widening here keeps `libsqlConnection(createClient(…))`
   * working with no ceremony; the values are normalized below anyway.
   */
  execute(stmt: { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
    lastInsertRowid?: bigint | number;
  }>;
}

/** Build a `Connection` backed by an `@libsql/client` client. */
export function libsqlConnection(client: LibSqlLike): Connection {
  return {
    async select(sql, bindings) {
      const { rows } = await client.execute({ sql, args: bindings });
      // Normalize libSQL's Row objects to plain records for casts/serialization.
      return rows.map((row) => ({ ...row }));
    },
    async write(sql, bindings): Promise<WriteResult> {
      const { rowsAffected, lastInsertRowid } = await client.execute({ sql, args: bindings });
      return {
        rowsAffected,
        insertId: lastInsertRowid != null ? Number(lastInsertRowid) : undefined,
      };
    },
  };
}
