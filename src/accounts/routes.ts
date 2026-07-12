/**
 * The accounts HTTP surface — JSON endpoints, no views.
 *
 * Core cannot render your login page and shouldn't try: views are the app's, and
 * this module has to run on Workers. So these endpoints do the security-critical
 * part and return JSON; a full-stack template wraps them in controllers that
 * render forms, and an API template mounts them as-is.
 *
 * Every endpoint here is unauthenticated and touches credentials, so the whole
 * group is rate-limited. Without it, password reset is an email cannon you point
 * at whoever you name, and a six-digit 2FA code is guessable in an afternoon.
 */

import type { Router, Ctx } from "../core/http/router.js";
import { rateLimiter } from "../core/rate-limit.js";

import type { AccountsConfig } from "./config.js";
import {
  attempt,
  completeTwoFactor,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
} from "./flows.js";

export function registerAccountsRoutes(r: Router, config: AccountsConfig): void {
  const base = "/" + config.routes.prefix.replace(/^\/|\/$/g, "");
  const limit = rateLimiter({ max: config.rateLimit.max, window: config.rateLimit.window });

  /* ---------------------------------- login --------------------------------- */

  r.post(`${base}/login`, async (c: Ctx) => {
    const { email, password } = await body(c);
    if (!email || !password) return c.json({ error: "Email and password are required." }, 422);

    const result = await attempt(email, password);

    if (result.status === "failed") {
      // One message for a wrong email and a wrong password. Anything more specific
      // tells an attacker which addresses have accounts.
      return c.json({ error: "Those credentials don't match." }, 401);
    }

    if (result.status === "two-factor") {
      // Note what this is NOT: a session. Nothing is logged in yet.
      return c.json({ twoFactor: true, challenge: result.challenge }, 200);
    }

    return c.json({ user: publicUser(result.user) }, 200);
  })
    .middleware(limit)
    .name("accounts.login");

  r.post(`${base}/two-factor`, async (c: Ctx) => {
    const { challenge, code } = await body(c);
    if (!challenge || !code) return c.json({ error: "A challenge and a code are required." }, 422);

    const user = await completeTwoFactor(challenge, code);
    if (!user) return c.json({ error: "That code isn't valid." }, 401);

    return c.json({ user: publicUser(user) }, 200);
  })
    .middleware(limit)
    .name("accounts.two-factor");

  /* ------------------------------ password reset ---------------------------- */

  r.post(`${base}/password/forgot`, async (c: Ctx) => {
    const { email } = await body(c);
    if (!email) return c.json({ error: "An email is required." }, 422);

    await requestPasswordReset(email);

    // 202 whether or not that address has an account. The response must not be an
    // oracle for which emails are registered.
    return c.json({ status: "If that address has an account, a link is on its way." }, 202);
  })
    .middleware(limit)
    .name("accounts.password.forgot");

  r.post(`${base}/password/reset`, async (c: Ctx) => {
    const { token, password } = await body(c);
    if (!token || !password) return c.json({ error: "A token and a password are required." }, 422);

    const ok = await resetPassword(token, password);
    if (!ok) return c.json({ error: "That reset link is invalid or has expired." }, 422);

    return c.json({ status: "Your password has been reset." }, 200);
  })
    .middleware(limit)
    .name("accounts.password.reset");

  /* --------------------------- email verification --------------------------- */

  r.post(`${base}/email/verify`, async (c: Ctx) => {
    const { token } = await body(c);
    if (!token) return c.json({ error: "A token is required." }, 422);

    const user = await verifyEmail(token);
    if (!user) return c.json({ error: "That link is invalid or has expired." }, 422);

    return c.json({ status: "Your email is confirmed.", user: publicUser(user) }, 200);
  })
    .middleware(limit)
    .name("accounts.email.verify");

  r.post(`${base}/email/resend`, async (c: Ctx) => {
    const { email } = await body(c);
    if (!email) return c.json({ error: "An email is required." }, 422);

    const { accountStore } = await import("./store.js");
    const user = await accountStore().findByEmail(email);
    // Same reasoning as forgot-password: don't confirm whether the account exists.
    if (user && !user.email_verified_at) await sendVerificationEmail(user);

    return c.json({ status: "If that address needs confirming, a link is on its way." }, 202);
  })
    .middleware(limit)
    .name("accounts.email.resend");
}

/* --------------------------------- helpers -------------------------------- */

async function body(c: Ctx): Promise<Record<string, string>> {
  try {
    return (await c.req.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * What's safe to hand back. Explicitly allow-listed rather than deleting the
 * secrets — a deny-list means the next column someone adds leaks by default.
 */
function publicUser(user: { id: string | number; email: string; email_verified_at?: unknown }) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
  };
}
