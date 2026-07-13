import { Job, db, logger } from "@shaferllc/keel/core";
import { withoutTenant } from "@shaferllc/keel/teams";

/**
 * Deletes team invitations that expired over a week ago. Runs daily — the scheduled
 * half of the background story, where SendTeamInviteJob is the dispatched half.
 *
 * An expired invitation is already refused on accept, so this is housekeeping, not a
 * security fix. The week of slack is deliberate: it keeps a just-expired invite around
 * long enough to answer "that link expired" instead of "that link never existed",
 * which is the difference between a helpful error and a baffling one.
 *
 * `withoutTenant` because this genuinely spans every team, and saying so out loud is
 * the point — crossing a tenant boundary should be something you can grep for, never
 * something you arrive at by forgetting a `where`. (`team_invitations` isn't a
 * TenantModel, so the raw query would run either way; the wrapper states the intent.)
 */
export class PruneExpiredInvitationsJob extends Job {
  async handle(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleted = await withoutTenant(() =>
      db("team_invitations").where("expires_at", "<", cutoff).delete(),
    );

    logger().info("pruned expired team invitations", { deleted, cutoff });
  }
}
