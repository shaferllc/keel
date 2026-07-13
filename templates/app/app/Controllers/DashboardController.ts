import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";
import {
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  hasTwoFactor,
  pendingTwoFactorSetup,
} from "@shaferllc/keel/accounts";

import type { User } from "../Models/User.js";
import Dashboard from "../../resources/views/dashboard.js";
import TwoFactorSetup from "../../resources/views/auth/two-factor-setup.js";

const ISSUER = "Keel App";

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

    const existing = await pendingTwoFactorSetup(user as never, { issuer: ISSUER });
    const setup = existing ?? (await enableTwoFactor(user as never, { issuer: ISSUER }));

    return c.html(
      await view(TwoFactorSetup, {
        qr: setup.qr,
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
      const pending = await pendingTwoFactorSetup(user as never, { issuer: ISSUER });
      return c.html(
        await view(TwoFactorSetup, {
          qr: pending?.qr ?? null,
          uri: pending?.uri ?? null,
          secret: pending?.secret ?? null,
          recoveryCodes: pending?.recoveryCodes ?? [],
          error: "That code isn't valid. Check the authenticator and try again.",
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
