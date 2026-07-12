/**
 * Where accounts reads and writes users.
 *
 * The module refuses to assume you use a `Model` — it talks to a table through
 * the query builder, exactly like `billing` parameterizes its billable table. If
 * your users live somewhere else entirely (an auth service, a legacy schema),
 * replace the whole thing:
 *
 *   setAccountStore({ findById, findByEmail, update });
 */

import { db, type Row } from "../core/database.js";

/** The columns accounts needs. Everything else on your users table is untouched. */
export interface AccountUser extends Row {
  id: string | number;
  email: string;
  /** The hashed password. Never the plaintext. */
  password?: string | null;
  email_verified_at?: string | null;
  /** The TOTP secret, encrypted at rest. */
  two_factor_secret?: string | null;
  /** Hashed, single-use recovery codes, as a JSON array. */
  two_factor_recovery_codes?: string | null;
  two_factor_confirmed_at?: string | null;
}

export interface AccountStore {
  findById(id: string | number): Promise<AccountUser | null>;
  findByEmail(email: string): Promise<AccountUser | null>;
  update(id: string | number, values: Row): Promise<void>;
}

/** The default store: a table, through the query builder. */
export function tableStore(table: string): AccountStore {
  return {
    async findById(id) {
      return (await db(table).where("id", id).first()) as AccountUser | null;
    },
    async findByEmail(email) {
      // Emails are case-insensitive in practice; store them lowercased and look
      // them up the same way, or "Ada@…" and "ada@…" become two accounts.
      return (await db(table).where("email", email.toLowerCase()).first()) as AccountUser | null;
    },
    async update(id, values) {
      await db(table).where("id", id).update(values);
    },
  };
}

let store: AccountStore | undefined;

export function setAccountStore(next: AccountStore | undefined): void {
  store = next;
}

export function accountStore(): AccountStore {
  if (!store) {
    throw new Error(
      "No account store. Register AccountsServiceProvider, or call setAccountStore().",
    );
  }
  return store;
}
