/**
 * The `watch_entries` table. Contributed by the provider via `this.migrations()`
 * and run by `keel migrate` alongside the app's own — the same path any package
 * ships schema on.
 */

import type { Migration } from "../core/migrations.js";

export function watchMigration(table = "watch_entries"): Migration {
  return {
    name: `watch_00_create_${table}`,
    up: (schema) =>
      schema.createTable(table, (t) => {
        t.string("uuid").unique();
        t.string("batch_id");
        t.string("type", 32);
        t.string("family_hash").nullable();
        t.text("content");
        t.text("tags");
        t.bigInteger("created_at");
      }),
    down: (schema) => schema.dropTable(table),
  };
}
