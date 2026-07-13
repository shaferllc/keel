import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";
import {
  acceptInvitation,
  createTeam,
  currentTeam,
  invite,
  pendingInvitations,
  revokeInvitation,
  runForTeam,
  switchTeam,
  teamsFor,
  type Role,
} from "@shaferllc/keel/teams";

import type { User } from "../Models/User.js";
import { Project } from "../Models/Project.js";
import { Team as BillableTeam } from "../Models/Team.js";
import Teams from "../../resources/views/teams/index.js";

export class TeamController {
  async index(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    // Users created before register started minting a personal team have no
    // membership — teamContext() then skips runForTeam, and Project.all() 500s.
    let teamId = currentTeam();
    if (typeof teamId !== "number") {
      let teams = await teamsFor(user.id);
      if (!teams.length) {
        const team = await createTeam(`${user.name}'s team`, user.id);
        await switchTeam(user.id, team.id);
        teams = [team];
      } else {
        await switchTeam(user.id, teams[0]!.id);
      }
      return runForTeam(teams[0]!.id, () => this.renderIndex(c, user, teams[0]!.id));
    }

    return this.renderIndex(c, user, teamId);
  }

  private async renderIndex(c: Ctx, user: User, teamId: number) {
    const billable = await BillableTeam.find(teamId);
    const subscribed = billable ? await billable.subscribed() : false;

    return c.html(
      await view(Teams, {
        teams: (await teamsFor(user.id)).map((t) => ({ id: t.id, name: t.name })),
        current: teamId,
        projects: (await Project.all()).map((p) => ({ id: p.id, name: p.name })),
        invitations: (await pendingInvitations(teamId)).map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
        })),
        subscribed,
        emailVerified: !!user.email_verified_at,
      }),
    );
  }

  async store(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const body = await c.req.parseBody();
    await createTeam(String(body.name ?? "New team"), user.id);

    return c.redirect("/teams");
  }

  async switch(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const body = await c.req.parseBody();
    await switchTeam(user.id, Number(body.team_id));

    return c.redirect("/teams");
  }

  async invite(c: Ctx) {
    const teamId = currentTeam();
    if (typeof teamId !== "number") return c.redirect("/teams");

    const body = await c.req.parseBody();
    await invite(teamId, String(body.email ?? ""), (body.role as Role) ?? "member");

    return c.redirect("/teams");
  }

  async revokeInvite(c: Ctx) {
    const body = await c.req.parseBody();
    await revokeInvitation(Number(body.invitation_id));
    return c.redirect("/teams");
  }

  async accept(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const team = await acceptInvitation(c.req.param("token") ?? "", user.id, user.email);

    return team ? c.redirect("/teams") : c.text("That invitation is invalid or has expired.", 422);
  }

  async createProject(c: Ctx) {
    const body = await c.req.parseBody();

    // Stamped with the current team by TenantModel — no team_id here on purpose.
    await Project.create({ name: String(body.name ?? "Untitled") });

    return c.redirect("/teams");
  }
}
