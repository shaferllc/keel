import type { Ctx } from "@shaferllc/keel/core";
import { auth, hash, session, validate, view } from "@shaferllc/keel/core";
import { attempt, completeTwoFactor, requestPasswordReset, resetPassword } from "@shaferllc/keel/accounts";
import { z } from "zod";

import { User } from "../Models/User.js";
import Login from "../../resources/views/auth/login.js";
import Register from "../../resources/views/auth/register.js";
import TwoFactor from "../../resources/views/auth/two-factor.js";
import Forgot from "../../resources/views/auth/forgot.js";

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
      // One message for a wrong email and a wrong password — anything more specific
      // tells a stranger which addresses have accounts here.
      return c.html(await view(Login, { error: "Those credentials don't match." }), 401);
    }

    if (result.status === "two-factor") {
      // NOT a session. Nothing is logged in until the code checks out.
      session().put("2fa_challenge", result.challenge);
      return c.redirect("/two-factor");
    }

    auth().login(result.user.id);
    return c.redirect("/dashboard");
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

    return c.redirect("/dashboard");
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

    auth().login(user.id);
    return c.redirect("/dashboard");
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

    // The same answer whether or not that address has an account.
    return c.html(await view(Forgot, { sent: true }));
  }

  async reset(c: Ctx) {
    const body = await c.req.parseBody();

    const ok = await resetPassword(String(body.token ?? ""), String(body.password ?? ""));
    if (!ok) return c.text("That reset link is invalid or has expired.", 422);

    return c.redirect("/login");
  }
}
