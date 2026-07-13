import type { Router, Ctx } from "@shaferllc/keel/core";
import { auth } from "@shaferllc/keel/core";
import { apiResource } from "@shaferllc/keel/api";
import { requireRole } from "@shaferllc/keel/teams";
import { z } from "zod";

import { AuthController } from "../app/Controllers/AuthController.js";
import { TeamController } from "../app/Controllers/TeamController.js";
import { DashboardController } from "../app/Controllers/DashboardController.js";
import { BillingController } from "../app/Controllers/BillingController.js";
import { HomeController } from "../app/Controllers/HomeController.js";
import { SocialAuthController } from "../app/Controllers/SocialAuthController.js";
import { Project } from "../app/Models/Project.js";

const authenticated = async (c: Ctx, next: () => Promise<void>) => {
  if (auth().guest()) return c.redirect("/login");
  await next();
};

const admin = requireRole("admin");

const ProjectBody = z.object({
  name: z.string().min(1).max(120),
});

export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);
  router.get("/health", (c: Ctx) => c.json({ ok: true }));

  router.get("/login", [AuthController, "showLogin"]).name("login");
  router.post("/login", [AuthController, "login"]);

  router.get("/two-factor", [AuthController, "showTwoFactor"]);
  router.post("/two-factor", [AuthController, "twoFactor"]);

  router.get("/register", [AuthController, "showRegister"]).name("register");
  router.post("/register", [AuthController, "register"]);

  router.post("/logout", [AuthController, "logout"]).name("logout");

  // Social sign-in. The provider is a path param, so one pair of routes serves every
  // provider in config/services.ts; an unconfigured one 403s rather than bouncing the
  // user to an OAuth error page.
  router.get("/auth/:provider", [SocialAuthController, "redirect"]);
  router.get("/auth/:provider/callback", [SocialAuthController, "callback"]);

  router.get("/forgot-password", [AuthController, "showForgot"]);
  router.post("/forgot-password", [AuthController, "forgot"]);
  router.get("/reset-password", [AuthController, "showReset"]);
  router.post("/reset-password", [AuthController, "reset"]);

  router.get("/verify-email", [AuthController, "verify"]);
  router.post("/verify-email/resend", [AuthController, "resendVerification"]).middleware(authenticated);

  router.get("/dashboard", [DashboardController, "index"]).middleware(authenticated).name("dashboard");
  router.post("/two-factor/enable", [DashboardController, "startTwoFactor"]).middleware(authenticated);
  router.post("/two-factor/confirm", [DashboardController, "confirmTwoFactor"]).middleware(authenticated);
  router.post("/two-factor/disable", [DashboardController, "disableTwoFactor"]).middleware(authenticated);

  router.get("/teams", [TeamController, "index"]).middleware(authenticated).name("teams");
  router.post("/teams", [TeamController, "store"]).middleware(authenticated);
  router.post("/teams/switch", [TeamController, "switch"]).middleware(authenticated);
  router.post("/teams/invite", [TeamController, "invite"]).middleware([authenticated, admin]);
  router.post("/teams/invite/revoke", [TeamController, "revokeInvite"]).middleware([authenticated, admin]);
  router.get("/invitations/:token", [TeamController, "accept"]).middleware(authenticated);

  router.post("/projects", [TeamController, "createProject"]).middleware(authenticated);

  router.get("/billing", [BillingController, "pricing"]).middleware(authenticated).name("billing");
  router.post("/billing/subscribe", [BillingController, "subscribe"]).middleware([authenticated, admin]);
  router.post("/billing/portal", [BillingController, "portal"]).middleware([authenticated, admin]);

  /**
   * A REST API over the same projects the HTML pages show — five routes, documented at
   * /docs, and multi-tenant without a line of tenancy code here.
   *
   * It lives under `/api/projects`, not `/projects`, because the HTML form above already
   * owns `POST /projects`. Two handlers on one method+path is a silent shadowing bug:
   * whichever registered first wins, and the other simply never runs.
   *
   * The tenancy is the part worth pausing on. `Project` is a `TenantModel`, so every
   * query generated here is already constrained to the caller's team — no `scope:`
   * option, no `where("team_id", …)`, and nothing to forget. `GET /api/projects/1`
   * returns 404 for another team's project rather than leaking it, and a POST is
   * stamped with the caller's team on the way in.
   *
   * Access is deny-by-default: every action you don't name returns 403. Here it opens
   * to a signed-in user, and guests are refused rather than 500ing — a guest has no
   * team, and a tenant query without one throws, by design. Deleting takes an admin,
   * matching the HTML side.
   */
  apiResource(router, Project, {
    path: "api/projects",
    name: "api.projects",
    filter: ["name"],
    sort: ["name", "created_at", "id"],
    body: ProjectBody,
    access: {
      read: () => !auth().guest(),
      create: () => !auth().guest(),
      update: () => !auth().guest(),
      delete: async () => !auth().guest() && (await isAdmin()),
    },
    tags: ["projects"],
  });
}

/** Admin-or-better in the current team. */
async function isAdmin(): Promise<boolean> {
  const { currentTeam, memberOf } = await import("@shaferllc/keel/teams");
  const teamId = currentTeam();
  const id = auth().id();
  if (typeof teamId !== "number" || !id) return false;
  return memberOf(id, teamId, "admin");
}
