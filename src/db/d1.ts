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

    /**
     * D1 has no interactive transactions — it can't hold one open across awaits
     * over its HTTP protocol, and a `BEGIN` sent through `prepare()` is rejected.
     *
     * So say that, rather than letting the generic BEGIN fallback fire and fail
     * with something cryptic from the driver. A transaction that quietly isn't one
     * is far worse than a transaction that refuses to start.
     */
    async begin(): Promise<never> {
      throw new Error(
        "D1 does not support interactive transactions. Use `database.batch([...])` for an " +
          "atomic group of statements, or run transactional work against a database that " +
          "supports them (Postgres, libSQL, SQLite).",
      );
    },
  };
}
