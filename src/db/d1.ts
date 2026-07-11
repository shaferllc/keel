/**
 * A Keel `Connection` for Cloudflare D1. Pass your D1 binding (from `env.DB`)
 * and register it — dialect `"sqlite"`:
 *
 *   import { d1Connection } from "@shaferllc/keel/db/d1";
 *   import { setConnection } from "@shaferllc/keel/core";
 *
 *   setConnection(d1Connection(env.DB), "sqlite");
 *
 * The binding is duck-typed — this module imports no driver and no
 * `@cloudflare/workers-types`, so it stays edge-native and dependency-free. Any
 * object shaped like a D1 database works.
 */

import type { Connection, Row, WriteResult } from "../core/database.js";

/** The slice of the D1 `Database` API this adapter uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = Row>(): Promise<{ results?: T[] }>;
      run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>;
    };
  };
}

/** Build a `Connection` backed by a Cloudflare D1 binding. */
export function d1Connection(database: D1Like): Connection {
  return {
    async select(sql, bindings) {
      const { results } = await database.prepare(sql).bind(...bindings).all<Row>();
      return results ?? [];
    },
    async write(sql, bindings): Promise<WriteResult> {
      const { meta } = await database.prepare(sql).bind(...bindings).run();
      return { rowsAffected: meta.changes ?? 0, insertId: meta.last_row_id };
    },
  };
}
