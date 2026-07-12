import type { Migration } from "@keel/core";

/** A tiny table so the example app runs real queries (for the Watch demo). */
const migration: Migration = {
  name: "01_create_notes",
  up: (schema) =>
    schema.createTable("notes", (t) => {
      t.id();
      t.string("body");
      t.bigInteger("created_at");
    }),
  down: (schema) => schema.dropTable("notes"),
};

export default migration;
