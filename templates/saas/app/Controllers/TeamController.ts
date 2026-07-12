import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";
import {
  acceptInvitation,
  createTeam,
  currentTeam,
  invite,
  pendingInvitations,
  switchTeam,
  teamsFor,
  type Role,
} from "@shaferllc/keel/teams";

import type { User } from "../Models/User.js";
import { Project } from "../Models/Project.js";
import Teams from "../../resources/views/teams/index.js";

export class TeamController {
  async index(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const teamId = currentTeam();

    return c.html(
      await view(Teams, {
        teams: (await teamsFor(user.id)).map((t) => ({ id: t.id, name: t.name })),
        current: typeof teamId === "number" ? teamId : null,
        // Scoped automatically — this is the current team's projects, and there is
        // no `where` to forget.
        projects: (await Project.all()).map((p) => ({ id: p.id, name: p.name })),
        invitations: teamId ? await pendingInvitations(teamId) : [],
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

    // Returns false for a team they aren't in — the check is the point.
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

  async accept(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    // The invited address is re-checked, so a forwarded link can't be redeemed by
    // whoever happens to hold it.
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
