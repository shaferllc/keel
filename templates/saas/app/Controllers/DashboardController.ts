import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";
import { enableTwoFactor, hasTwoFactor } from "@shaferllc/keel/accounts";

import type { User } from "../Models/User.js";
import Dashboard from "../../resources/views/dashboard.js";

export class DashboardController {
  async index(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    return c.html(
      await view(Dashboard, {
        name: user.name,
        twoFactor: hasTwoFactor(user as never),
      }),
    );
  }

  /** Step one of turning 2FA on: a secret and recovery codes. It is NOT on yet. */
  async startTwoFactor(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    const setup = await enableTwoFactor(user as never, { issuer: "Keel App" });

    // Render setup.uri to a QR code locally — it contains the shared secret, so it
    // must never be sent to a third-party QR service.
    return c.json({
      uri: setup.uri,
      secret: setup.secret,
      recoveryCodes: setup.recoveryCodes,
      next: "POST /two-factor/confirm with a code from your authenticator to turn it on.",
    });
  }
}
