/**
 * The accounts schema — four columns on the users table, and no tokens table.
 *
 * There is deliberately no `password_resets` table. Reset and verification tokens
 * carry their own purpose and expiry inside the ciphertext (see tokens.ts), so
 * there is nothing to insert, nothing to look up, and nothing to garbage-collect —
 * and no window where a forgotten cleanup job leaves a live token in a row.
 *
 * Columns are added with `schema.raw()` because the builder has no `alterTable`,
 * and the SQL is kept to the intersection sqlite, mysql, and postgres all accept —
 * the same approach as `billingMigration`.
 */

import type { Migration } from "../core/migrations.js";

const COLUMNS = [
  "email_verified_at TIMESTAMP",
  // Encrypted at rest: a database leak must not hand over everyone's second factor.
  "two_factor_secret TEXT",
  // Hashed, single-use, JSON — then encrypted, same reasoning.
  "two_factor_recovery_codes TEXT",
  // Null until a working code proves the user can actually generate one.
  "two_factor_confirmed_at TIMESTAMP",
];

export function accountsMigration(userTable = "users"): Migration {
  return {
    name: "accounts_00_add_account_columns",

    async up(schema) {
      for (const column of COLUMNS) {
        await schema.raw(`ALTER TABLE ${userTable} ADD COLUMN ${column}`);
      }
    },

    async down(schema) {
      for (const column of COLUMNS) {
        const name = column.split(" ")[0]!;
        // sqlite couldn't drop columns until 3.35; a failed drop shouldn't wedge
        // a rollback of everything else.
        await schema.raw(`ALTER TABLE ${userTable} DROP COLUMN ${name}`).catch(() => {});
      }
    },
  };
}
