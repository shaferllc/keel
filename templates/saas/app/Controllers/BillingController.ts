import type { Ctx } from "@shaferllc/keel/core";
import { auth, config, view } from "@shaferllc/keel/core";
import { currentTeam } from "@shaferllc/keel/teams";
import { resolveBillableUsing } from "@shaferllc/keel/billing";

import type { User } from "../Models/User.js";
import { Team } from "../Models/Team.js";
import Pricing from "../../resources/views/billing/pricing.js";

/** Load the current team as a Billable, with the owner's email for the gateway. */
async function billableCurrentTeam(): Promise<InstanceType<typeof Team> | null> {
  const teamId = currentTeam();
  if (typeof teamId !== "number") return null;

  const team = await Team.find(teamId);
  if (!team) return null;

  const owner = await (await import("../Models/User.js")).User.find(Number(team.owner_id));
  if (owner?.email) team.withOwnerEmail(owner.email);
  return team;
}

export class BillingController {
  async pricing(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const team = await billableCurrentTeam();
    const subscribed = team ? await team.subscribed() : false;

    return c.html(
      await view(Pricing, {
        subscribed,
        plan: config<string>("billing.plans.pro", "price_pro"),
        gateway: config<string>("billing.default", "fake"),
      }),
    );
  }

  async subscribe(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const team = await billableCurrentTeam();
    if (!team) return c.redirect("/teams");

    if (await team.subscribed()) return c.redirect("/billing");

    const price = config<string>("billing.plans.pro", "price_pro");
    const base = config<string>("app.url", "http://localhost:3000").replace(/\/$/, "");

    const session = await team.newSubscription("default", price).checkout({
      successUrl: `${base}/billing?success=1`,
      cancelUrl: `${base}/billing`,
    });

    if (session.url) return c.redirect(session.url);
    return c.text("Checkout started. Open your payment overlay with the client token.", 200);
  }

  async portal(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const team = await billableCurrentTeam();
    if (!team || !team.hasBillingId()) return c.redirect("/billing");

    const base = config<string>("app.url", "http://localhost:3000").replace(/\/$/, "");
    const portal = await team.billingPortal(`${base}/billing`);
    return c.redirect(portal.url);
  }
}

/** Wire webhook → Team lookups. Call once from AppServiceProvider.boot(). */
export function registerBillableResolver(): void {
  resolveBillableUsing(async (customerId) => {
    const team = await Team.query().where("billing_customer_id", customerId).first();
    if (!team) return null;
    return { id: Number(team.id), type: "Team" };
  });
}
