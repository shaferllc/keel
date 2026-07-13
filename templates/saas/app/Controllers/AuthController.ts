import type { Ctx } from "@shaferllc/keel/core";
import { auth, hash, session, validate, view } from "@shaferllc/keel/core";
import {
  attempt,
  completeTwoFactor,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
} from "@shaferllc/keel/accounts";
import { createTeam, switchTeam } from "@shaferllc/keel/teams";
import { z } from "zod";

import { User } from "../Models/User.js";
import Login from "../../resources/views/auth/login.js";
import Register from "../../resources/views/auth/register.js";
import TwoFactor from "../../resources/views/auth/two-factor.js";
import Forgot from "../../resources/views/auth/forgot.js";
import Reset from "../../resources/views/auth/reset.js";
import Verify from "../../resources/views/auth/verify.js";

const Credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const NewUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export class AuthController {
  async showLogin(c: Ctx) {
    return c.html(await view(Login, { error: null }));
  }

  async login(c: Ctx) {
    const { email, password } = await validate(Credentials, await c.req.parseBody());

    const result = await attempt(email, password);

    if (result.status === "failed") {
      return c.html(await view(Login, { error: "Those credentials don't match." }), 401);
    }

    if (result.status === "two-factor") {
      session().put("2fa_challenge", result.challenge);
      return c.redirect("/two-factor");
    }

    auth().login(result.user.id);
    return c.redirect("/teams");
  }

  async showTwoFactor(c: Ctx) {
    return c.html(await view(TwoFactor, { error: null }));
  }

  async twoFactor(c: Ctx) {
    const body = await c.req.parseBody();
    const challenge = session().get("2fa_challenge") as string | undefined;

    if (!challenge) return c.redirect("/login");

    const user = await completeTwoFactor(challenge, String(body.code ?? ""));

    if (!user) {
      return c.html(await view(TwoFactor, { error: "That code isn't valid." }), 401);
    }

    session().forget("2fa_challenge");
    auth().login(user.id);

    return c.redirect("/teams");
  }

  async showRegister(c: Ctx) {
    return c.html(await view(Register, { error: null }));
  }

  async register(c: Ctx) {
    const data = await validate(NewUser, await c.req.parseBody());

    if (await User.query().where("email", data.email.toLowerCase()).first()) {
      return c.html(await view(Register, { error: "That email is already registered." }), 422);
    }

    const user = await User.create({
      name: data.name,
      email: data.email.toLowerCase(),
      password: await hash.make(data.password),
    });

    // A personal team, immediately. Without one the user has no tenant.
    const team = await createTeam(`${data.name}'s team`, user.id);
    await switchTeam(user.id, team.id);

    await sendVerificationEmail(user as never);

    auth().login(user.id);
    return c.redirect("/teams");
  }

  logout(c: Ctx) {
    auth().logout();
    return c.redirect("/");
  }

  async showForgot(c: Ctx) {
    return c.html(await view(Forgot, { sent: false }));
  }

  async forgot(c: Ctx) {
    const body = await c.req.parseBody();
    await requestPasswordReset(String(body.email ?? ""));
    return c.html(await view(Forgot, { sent: true }));
  }

  async showReset(c: Ctx) {
    const token = c.req.query("token") ?? "";
    return c.html(await view(Reset, { token, error: null }));
  }

  async reset(c: Ctx) {
    const body = await c.req.parseBody();
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");

    const ok = await resetPassword(token, password);
    if (!ok) {
      return c.html(
        await view(Reset, { token, error: "That reset link is invalid or has expired." }),
        422,
      );
    }

    return c.redirect("/login");
  }

  async verify(c: Ctx) {
    const token = c.req.query("token") ?? "";
    const user = token ? await verifyEmail(token) : null;

    return c.html(
      await view(Verify, {
        ok: !!user,
        email: user?.email ?? null,
      }),
      user ? 200 : 422,
    );
  }

  async resendVerification(c: Ctx) {
    const user = await auth().user<User>();
    if (!user) return c.redirect("/login");

    if (!user.email_verified_at) {
      await sendVerificationEmail(user as never);
    }

    return c.redirect("/teams");
  }
}
