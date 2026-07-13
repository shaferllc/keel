import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";
import {
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  hasTwoFactor,
} from "@shaferllc/keel/accounts";

import type { User } from "../Models/User.js";
import Dashboard from "../../resources/views/dashboard.js";
import TwoFactorSetup from "../../resources/views/auth/two-factor-setup.js";

export class DashboardController {
  async index(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    return c.html(
      await view(Dashboard, {
        name: user.name,
        twoFactor: hasTwoFactor(user as never),
        emailVerified: !!user.email_verified_at,
      }),
    );
  }

  async startTwoFactor(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    if (hasTwoFactor(user as never)) return c.redirect("/dashboard");

    const setup = await enableTwoFactor(user as never, { issuer: "Keel SaaS" });

    return c.html(
      await view(TwoFactorSetup, {
        uri: setup.uri,
        secret: setup.secret,
        recoveryCodes: setup.recoveryCodes,
        error: null,
      }),
    );
  }

  async confirmTwoFactor(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const body = await c.req.parseBody();
    const ok = await confirmTwoFactor(user as never, String(body.code ?? ""));
    if (!ok) {
      return c.html(
        await view(TwoFactorSetup, {
          uri: null,
          secret: null,
          recoveryCodes: [],
          error: "That code isn't valid. Try again from the dashboard.",
        }),
        422,
      );
    }

    return c.redirect("/dashboard");
  }

  async disableTwoFactor(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    await disableTwoFactor(user as never);
    return c.redirect("/dashboard");
  }
}
