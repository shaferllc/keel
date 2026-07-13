import type { Migration } from "@shaferllc/keel/core";

/**
 * Social login columns.
 *
 * The provider ids are unique. Two local users must never map to one GitHub account,
 * or signing in with it becomes a coin flip over which of them you become.
 *
 * `password` stays NOT NULL — SQLite can't relax that without rebuilding the table,
 * and it doesn't need to. A user who arrives through OAuth is given a random hash they
 * were never told, so password login simply never succeeds for them and "forgot
 * password" is the supported way to set one. See SocialAuthController.
 */
const migration: Migration = {
  name: "0003_add_social_columns",

  async up(schema) {
    await schema.alterTable("users", (t) => {
      t.string("github_id").nullable();
      t.string("google_id").nullable();
      t.text("avatar_url").nullable();
    });

    await schema.alterTable("users", (t) => {
      t.uniqueIndex("github_id", "users_github_id_unique");
      t.uniqueIndex("google_id", "users_google_id_unique");
    });
  },

  async down(schema) {
    await schema.alterTable("users", (t) => {
      t.dropIndex("users_github_id_unique");
      t.dropIndex("users_google_id_unique");
      t.dropColumn("github_id");
      t.dropColumn("google_id");
      t.dropColumn("avatar_url");
    });
  },
};

export default migration;
