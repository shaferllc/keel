import { ServiceProvider, setConnection } from "@keel/core";
import { createClient } from "@libsql/client";
import { libsqlConnection, type LibSqlLike } from "../../src/db/libsql.js";

/**
 * Registers a local SQLite (libSQL) connection so the example app has a real
 * database — used by the `/notes` route and by Keel Watch's database storage.
 */
export class DatabaseServiceProvider extends ServiceProvider {
  register(): void {
    const client = createClient({ url: "file:database/keel.sqlite" });
    // The libSQL client is duck-typed by the adapter; cast past its stricter types.
    setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");
  }
}
