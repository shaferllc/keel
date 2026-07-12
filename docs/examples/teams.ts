// Typechecked example for docs/teams.md.
import { Application, sessionMiddleware } from "@shaferllc/keel/core";
import {
  TeamsServiceProvider,
  TenantModel,
  TENANT_SCOPE,
  acceptInvitation,
  createTeam,
  currentTeam,
  invite,
  memberOf,
  pendingInvitations,
  requireRole,
  revokeInvitation,
  roleAtLeast,
  roleOf,
  runForTeam,
  switchTeam,
  teamContext,
  teamsFor,
  withoutTenant,
} from "@shaferllc/keel/teams";

const app = new Application();
app.register(TeamsServiceProvider);

// Put every request inside a team; TenantModel queries are scoped from then on.
const middleware = [sessionMiddleware(), teamContext()];

/* -------------------------------- a tenant model -------------------------- */

class Post extends TenantModel {
  static override table = "posts";
  static override fillable = ["title"];

  declare id: number;
  declare title: string;
}

async function inAHandler() {
  const mine = await Post.all(); // only the current team's
  const one = await Post.find(1); // null if it belongs to another team
  const made = await Post.create({ title: "Hi" }); // stamped with the current team
  return { mine, one, made, team: currentTeam() };
}

/* ------------------------------ outside a request ------------------------- */

async function aJob(team: { id: number }) {
  // Without this, the query throws — it does not quietly return every team's rows.
  await runForTeam(team, async () => {
    await Post.all();
  });
}

async function anAdminReport() {
  // Crossing tenants, said out loud so it can be found at audit time.
  return withoutTenant(() => Post.withoutGlobalScope(TENANT_SCOPE).get());
}

/* --------------------------------- membership ----------------------------- */

async function onboarding(userId: number) {
  const team = await createTeam("Acme", userId);

  await teamsFor(userId);
  await roleOf(userId, team.id);
  await memberOf(userId, team.id, "admin");
  await switchTeam(userId, team.id); // false if they aren't a member

  return team;
}

const adminsOnly = requireRole("admin");
const ordered = roleAtLeast("owner", "admin"); // true

/* -------------------------------- invitations ----------------------------- */

async function inviteSomeone(teamId: number, userId: number) {
  const { token, invitation } = await invite(teamId, "grace@example.com", "admin");

  await pendingInvitations(teamId);
  await revokeInvitation(invitation.id);

  // The invited address is re-checked, so a forwarded link can't be redeemed by
  // someone else.
  return acceptInvitation(token, userId, "grace@example.com");
}

export {
  app,
  middleware,
  Post,
  inAHandler,
  aJob,
  anAdminReport,
  onboarding,
  adminsOnly,
  ordered,
  inviteSomeone,
};
