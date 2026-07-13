import { env } from "@shaferllc/keel/core";

/**
 * Teams — multi-tenancy, membership, roles, invitations.
 *
 * `mail.from` is not optional in practice. `invite()` sends the invitation email
 * itself, and a message with no from address — and no default on the mailer — throws.
 * Without this block, inviting anyone 500s. `config/accounts.ts` sets the same value
 * for password-reset and verification mail; both read MAIL_FROM.
 *
 * `personalTeams` stays on, so every user has a team from the moment they sign up and
 * `teamContext()` always has one to resolve. It also means tenancy is in the schema on
 * day one rather than backfilled onto tables that already hold customer data.
 */
export default {
  userTable: "users",
  personalTeams: true,

  invitations: {
    expiresInHours: 72,
    url: "/invitations/:token",
  },

  mail: {
    from: env("MAIL_FROM", "noreply@localhost"),
  },
};
