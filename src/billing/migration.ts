/**
 * The billing schema — gateway-neutral so one set of tables serves Stripe and
 * Paddle. `subscriptions` and `subscription_items` are created through the
 * fluent builder; the columns added to the existing billable table (`users`)
 * and the secondary indexes go through `schema.raw()` because the builder has
 * no `alterTable`/`index` (see src/core/migrations.ts).
 *
 * The `ADD COLUMN` / `CREATE INDEX` SQL is kept to the intersection that sqlite,
 * mysql, and postgres all accept, and each runs exactly once (the migrator
 * tracks applied migrations by name).
 */

import type { Migration } from "../core/migrations.js";

export function billingMigration(billableTable = "users"): Migration {
  return {
    name: "billing_00_create_subscriptions",
    async up(schema) {
      await schema.createTable("subscriptions", (t) => {
        t.id();
        t.integer("billable_id");
        t.string("billable_type").default("User");
        t.string("type", 64).default("default");
        t.string("gateway", 32);
        t.string("provider_id").unique();
        t.string("provider_status", 64);
        t.json("provider_price").nullable();
        t.integer("quantity").nullable();
        t.timestamp("trial_ends_at").nullable();
        t.timestamp("starts_at").nullable();
        t.timestamp("ends_at").nullable();
        t.timestamp("paused_at").nullable();
        t.timestamps();
      });

      await schema.createTable("subscription_items", (t) => {
        t.id();
        t.integer("subscription_id");
        t.string("provider_id").unique();
        t.string("provider_product");
        t.string("provider_price");
        t.integer("quantity").nullable();
        t.timestamps();
      });

      await schema.raw(
        "CREATE INDEX idx_subscriptions_billable ON subscriptions (billable_id, billable_type)",
      );
      await schema.raw(
        "CREATE INDEX idx_subscription_items_subscription ON subscription_items (subscription_id)",
      );

      // Billing columns on the billable (customer) table.
      for (const col of [
        "billing_gateway VARCHAR(32)",
        "billing_customer_id VARCHAR(255)",
        "pm_type VARCHAR(32)",
        "pm_last_four VARCHAR(8)",
        "trial_ends_at TIMESTAMP",
      ]) {
        await schema.raw(`ALTER TABLE ${billableTable} ADD COLUMN ${col}`);
      }
    },

    async down(schema) {
      await schema.dropTable("subscription_items");
      await schema.dropTable("subscriptions");
      for (const col of [
        "billing_gateway",
        "billing_customer_id",
        "pm_type",
        "pm_last_four",
        "trial_ends_at",
      ]) {
        await schema.raw(`ALTER TABLE ${billableTable} DROP COLUMN ${col}`).catch(() => {});
      }
    },
  };
}
