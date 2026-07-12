import { env } from "@shaferllc/keel/core";

/**
 * Every driver, out of the box. `DB_CONNECTION` picks one.
 *
 * The default is `d1` in production — Cloudflare is where this is meant to run —
 * and `sqlite` locally, so `npm run dev` needs no wrangler and no account. Both are
 * SQLite, so one schema and one set of migrations serve both.
 */
export default {
  default: env("DB_CONNECTION", "sqlite"),

  connections: {
    // Cloudflare D1. Inside the Worker the binding (env.DB) is used directly;
    // migrations and scripts reach the same database over the HTTP API.
    d1: {
      driver: "d1",
      binding: "DB",
      accountId: env("CLOUDFLARE_ACCOUNT_ID", ""),
      databaseId: env("D1_DATABASE_ID", ""),
      apiToken: env("CLOUDFLARE_API_TOKEN", ""),
    },

    // A local file. Zero setup — this is what `npm run dev` uses.
    sqlite: {
      driver: "libsql",
      url: env("DB_URL", "file:./database.sqlite"),
    },

    // libSQL over the network (Turso).
    turso: {
      driver: "libsql",
      url: env("TURSO_URL", ""),
      authToken: env("TURSO_AUTH_TOKEN", ""),
    },

    postgres: {
      driver: "pg",
      url: env("DATABASE_URL", ""),
    },
  },
};
