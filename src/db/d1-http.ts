/**
 * A Keel `Connection` for Cloudflare D1 over its **HTTP API**.
 *
 * The D1 binding (`env.DB`) only exists inside a running Worker, which leaves an
 * awkward hole: `keel migrate` runs on your laptop and in CI, where there is no
 * binding — so there was no way to create your tables. This closes it. Same
 * `Connection` interface, so migrations, models, and the query builder all work
 * against a real D1 database from anywhere:
 *
 *   import { d1HttpConnection } from "@shaferllc/keel/db/d1-http";
 *
 *   setConnection(d1HttpConnection({
 *     accountId: env("CLOUDFLARE_ACCOUNT_ID"),
 *     databaseId: env("D1_DATABASE_ID"),
 *     apiToken: env("CLOUDFLARE_API_TOKEN"),
 *   }), "sqlite");
 *
 * Use the **binding** (`@shaferllc/keel/db/d1`) inside the Worker — it's a direct
 * call with no network hop. Use this one for migrations and scripts. Both speak
 * SQLite, so the same schema serves both.
 *
 * `fetch` only — no SDK, nothing Node-specific.
 */

import type { Connection, Row, WriteResult } from "../core/database.js";

export interface D1HttpOptions {
  accountId: string;
  databaseId: string;
  /** An API token with D1 edit permission. */
  apiToken: string;
  /** Override the API base (for tests, or a proxy). */
  baseUrl?: string;
}

interface D1Response {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: {
    results?: Row[];
    meta?: { changes?: number; last_row_id?: number; rows_written?: number };
  }[];
}

/** Build a `Connection` that talks to D1 over HTTP. */
export function d1HttpConnection(options: D1HttpOptions): Connection {
  const base = options.baseUrl ?? "https://api.cloudflare.com/client/v4";
  const url = `${base}/accounts/${options.accountId}/d1/database/${options.databaseId}/query`;

  async function query(sql: string, params: unknown[]): Promise<D1Response["result"]> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });

    const payload = (await response.json()) as D1Response;

    if (!response.ok || !payload.success) {
      // Cloudflare returns its errors in the body with a 200 as often as not, so
      // the status alone is not enough to tell whether the statement ran.
      const message =
        payload.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ??
        `D1 request failed (${response.status})`;
      throw new Error(`D1: ${message}`);
    }

    return payload.result;
  }

  return {
    async select(sql, bindings) {
      const result = await query(sql, bindings);
      return result?.[0]?.results ?? [];
    },

    async write(sql, bindings): Promise<WriteResult> {
      const result = await query(sql, bindings);
      const meta = result?.[0]?.meta ?? {};

      return {
        rowsAffected: meta.changes ?? meta.rows_written ?? 0,
        insertId: meta.last_row_id != null ? Number(meta.last_row_id) : undefined,
      };
    },
  };
}
