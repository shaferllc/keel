/**
 * Keel Teams — multi-tenancy, membership, roles, invitations.
 * Imported from `@shaferllc/keel/teams`.
 *
 *   class Post extends TenantModel { static table = "posts"; }
 *   await Post.all();   // only the current team's posts. Always.
 *
 * Isolation is deny-by-default: a `TenantModel` query outside a team context
 * **throws** rather than quietly returning everything. Crossing tenants is possible,
 * but only by saying so — `withoutTenant(() => …)` — which is a thing you can grep
 * for at audit time. See context.ts for why the alternatives are worse.
 */

export { TeamsServiceProvider } from "./provider.js";

export { TenantModel, TENANT_SCOPE } from "./tenant.js";

export {
  currentTeam,
  currentTeamId,
  hasTeamContext,
  runForTeam,
  withoutTenant,
} from "./context.js";
export type { TeamContext } from "./context.js";

export {
  Team,
  Membership,
  ROLES,
  createTeam,
  memberOf,
  roleAtLeast,
  roleOf,
  switchTeam,
  teamsFor,
} from "./models.js";
export type { Role } from "./models.js";

export {
  acceptInvitation,
  invite,
  pendingInvitations,
  revokeInvitation,
} from "./invitations.js";
export type { Invitation, SentInvitation } from "./invitations.js";

export { requireRole, teamContext } from "./middleware.js";
export type { TeamContextOptions } from "./middleware.js";

export { teamsMigration } from "./migration.js";
export { defaultConfig, resolveConfig } from "./config.js";
export type { TeamsConfig } from "./config.js";
