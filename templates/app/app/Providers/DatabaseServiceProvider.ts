import { ServiceProvider, config, setConnection } from "@shaferllc/keel/core";

/**
 * Opens the connection every model and query builder reads through — on **Node**.
 * (In the Worker, worker.ts binds D1 directly and this provider isn't loaded.)
 *
 * Switching database is `DB_CONNECTION` and nothing else: no model or query changes,
 * because they all talk to a `Connection` rather than to a driver.
 *
 * `d1` here means the HTTP API rather than the binding — which is what lets
 * `keel migrate` reach your real D1 database from your laptop and from CI, where no
 * binding exists.
 */
export class DatabaseServiceProvider extends ServiceProvider {
  async register(): Promise<void> {
    const name = config<string>("database.default", "sqlite");

    if (name === "d1") {
      const { d1HttpConnection } = await import("@shaferllc/keel/db/d1-http");

      setConnection(
        d1HttpConnection({
          accountId: config<string>("database.connections.d1.accountId", ""),
          databaseId: config<string>("database.connections.d1.databaseId", ""),
          apiToken: config<string>("database.connections.d1.apiToken", ""),
        }),
        "sqlite",
      );
      return;
    }

    if (name === "postgres") {
      const { pgConnection } = await import("@shaferllc/keel/db/pg");
      const { Pool } = await import("pg");

      setConnection(
        pgConnection(new Pool({ connectionString: config<string>("database.connections.postgres.url", "") })),
        "postgres",
      );
      return;
    }

    // sqlite (a local file) or turso (libSQL over the network) — same driver.
    const { libsqlConnection } = await import("@shaferllc/keel/db/libsql");
    const { createClient } = await import("@libsql/client");

    const url = config<string>(`database.connections.${name}.url`, "file:./database.sqlite");
    const authToken = config<string>(`database.connections.${name}.authToken`, "");

    setConnection(libsqlConnection(createClient(authToken ? { url, authToken } : { url })), "sqlite");
  }
}
