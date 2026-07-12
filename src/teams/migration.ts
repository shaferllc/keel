/**
 * The teams schema: teams, memberships, invitations, and one column on users.
 *
 * `team_memberships` is what actually grants access — `teams.owner_id` is a
 * convenience, not an authorization source. A user is in a team if and only if a
 * membership row says so.
 */

import type { Migration } from "../core/migrations.js";

export function teamsMigration(userTable = "users"): Migration {
  return {
    name: "teams_00_create_teams",

    async up(schema) {
      await schema.createTable("teams", (t) => {
        t.id();
        t.string("name");
        t.string("slug").unique();
        t.integer("owner_id");
        t.timestamps();
      });

      await schema.createTable("team_memberships", (t) => {
        t.id();
        t.integer("team_id");
        t.integer("user_id");
        // owner | admin | member
        t.string("role", 32).default("member");
        t.timestamps();
      });

      await schema.createTable("team_invitations", (t) => {
        t.id();
        t.integer("team_id");
        t.string("email");
        t.string("role", 32).default("member");
        // The token's HASH. The token itself lives in the invitee's inbox and
        // nowhere else, so a database leak doesn't open every pending team.
        t.string("token");
        t.timestamp("expires_at");
        t.timestamps();
      });

      // One membership per user per team, enforced by the database rather than by
      // remembering to check — accepting an invitation twice must not double up.
      await schema.raw(
        "CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_unique ON team_memberships (team_id, user_id)",
      );
      await schema.raw(
        "CREATE INDEX IF NOT EXISTS team_invitations_email ON team_invitations (email)",
      );

      // Which team the user is currently looking at.
      await schema.raw(`ALTER TABLE ${userTable} ADD COLUMN current_team_id INTEGER`);
    },

    async down(schema) {
      await schema.dropTable("team_invitations");
      await schema.dropTable("team_memberships");
      await schema.dropTable("teams");
      await schema.raw(`ALTER TABLE ${userTable} DROP COLUMN current_team_id`).catch(() => {});
    },
  };
}
