/**
 * Teams configuration. Merged under `config("teams")` by the provider; override in
 * `config/teams.ts` (publish it with `keel vendor:publish --tag teams-config`).
 */

import { config } from "../core/helpers.js";

export interface TeamsConfig {
  /** The users table. Teams adds `current_team_id` to it and touches nothing else. */
  userTable: string;

  /**
   * Give every new user a team of their own on signup.
   *
   * On by default, and worth leaving on even for an app that feels single-user:
   * a "personal workspace" is just a team of one, and *adding* tenancy later means
   * backfilling every table and rewriting every query. Ignoring a team you have is
   * one unused row; needing a team you don't have is a migration nobody enjoys.
   */
  personalTeams: boolean;

  invitations: {
    expiresInHours: number;
    /** Where the emailed link points. `:token` is replaced. */
    url: string;
  };

  mail: { from?: string };
}

export const defaultConfig: TeamsConfig = {
  userTable: "users",
  personalTeams: true,
  invitations: {
    expiresInHours: 72,
    url: "/invitations/:token",
  },
  mail: {},
};

export function resolveConfig(): TeamsConfig {
  const raw = config<Partial<TeamsConfig>>("teams", {});

  return {
    userTable: raw.userTable ?? defaultConfig.userTable,
    personalTeams: raw.personalTeams ?? defaultConfig.personalTeams,
    invitations: { ...defaultConfig.invitations, ...raw.invitations },
    mail: { ...defaultConfig.mail, ...raw.mail },
  };
}
