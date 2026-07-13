import type { Router, Ctx } from "@shaferllc/keel/core";
import { auth } from "@shaferllc/keel/core";
import { requireRole } from "@shaferllc/keel/teams";

import { AuthController } from "../app/Controllers/AuthController.js";
import { TeamController } from "../app/Controllers/TeamController.js";
import { DashboardController } from "../app/Controllers/DashboardController.js";
import { BillingController } from "../app/Controllers/BillingController.js";
import { HomeController } from "../app/Controllers/HomeController.js";

const authenticated = async (c: Ctx, next: () => Promise<void>) => {
  if (auth().guest()) return c.redirect("/login");
  await next();
};

const admin = requireRole("admin");

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
}
