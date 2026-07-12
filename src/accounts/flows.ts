/**
 * The account flows. Controllers call these; the views stay yours.
 *
 * Everything security-critical lives here rather than in a template, because a
 * password-reset flow copy-pasted into five starter kits is four copies that
 * quietly rot. Templates render forms and call these six functions.
 */

import { hash } from "../core/crypto.js";
import { config } from "../core/helpers.js";
import { mail } from "../core/mail.js";

import { resolveConfig } from "./config.js";
import { accountStore, type AccountUser } from "./store.js";
import {
  emailVerificationToken,
  passwordResetToken,
  twoFactorChallenge,
  verifyEmailToken,
  verifyPasswordResetToken,
  verifyTwoFactorChallenge,
} from "./tokens.js";
import { hasTwoFactor, redeemRecoveryCode, verifyTwoFactorCode } from "./two-factor.js";

/* ---------------------------------- login --------------------------------- */

export type LoginResult =
  | { status: "ok"; user: AccountUser }
  /** Password was right; nothing is logged in yet. Send `challenge` back with a code. */
  | { status: "two-factor"; challenge: string }
  | { status: "failed" };

/**
 * Check a password. On success with 2FA on, this returns a **challenge, not a
 * session** — the caller logs nobody in until `completeTwoFactor()` succeeds.
 *
 * A wrong email and a wrong password are the same answer, and both do the same
 * amount of work: hashing a dummy password when the user doesn't exist keeps the
 * response time from telling an attacker which emails are real.
 */
export async function attempt(email: string, password: string): Promise<LoginResult> {
  const config = resolveConfig();
  const user = await accountStore().findByEmail(email);

  // `hash.dummy` when there's no user, so a missing account costs the same PBKDF2
  // as a wrong password. A fast "no such user" is a free enumeration oracle.
  // `user &&` guards the dummy from ever authenticating anyone.
  const ok = await hash.verify(user?.password ?? hash.dummy, password);
  if (!ok || !user) return { status: "failed" };

  if (hasTwoFactor(user)) {
    return {
      status: "two-factor",
      challenge: await twoFactorChallenge(user, config.twoFactor.challengeExpiresIn),
    };
  }

  return { status: "ok", user };
}

/**
 * Finish a 2FA login with either an authenticator code or a recovery code.
 * Returns the user only if the challenge is still valid *and* the code checks out.
 */
export async function completeTwoFactor(
  challenge: string,
  code: string,
): Promise<AccountUser | null> {
  const config = resolveConfig();
  const store = accountStore();

  const user = await verifyTwoFactorChallenge(challenge, (id) => store.findById(id));
  if (!user) return null;

  // A recovery code has a dash and is longer; a TOTP code is six digits. Try the
  // authenticator first — it's what almost everyone uses.
  if (await verifyTwoFactorCode(user, code, { window: config.twoFactor.window })) return user;
  if (await redeemRecoveryCode(user, code)) return user;

  return null;
}

/* ------------------------------ password reset ---------------------------- */

/**
 * Email a reset link — **or quietly do nothing**, if that address has no account.
 *
 * This never reveals whether the email exists. "No account with that address" is a
 * free account-enumeration oracle, and the endpoint is unauthenticated, so anyone
 * can ask it about anyone. The caller gets the same answer either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const config = resolveConfig();
  const user = await accountStore().findByEmail(email);
  if (!user) return;

  const token = await passwordResetToken(user, config.passwordReset.expiresIn);
  const link = absolute(config.passwordReset.url.replace(":token", encodeURIComponent(token)));

  const message = mail()
    .to(user.email)
    .subject("Reset your password")
    .html(
      `<p>Someone asked to reset your password.</p>` +
        `<p><a href="${link}">Choose a new password</a></p>` +
        `<p>The link expires in ${config.passwordReset.expiresIn}. If this wasn't you, ignore it — nothing has changed.</p>`,
    );

  if (config.mail.from) message.from(config.mail.from);
  await message.send();
}

/**
 * Spend a reset token. Returns false if it's expired, forged, or already used —
 * "already used" falls out of the token being bound to the old password hash, so
 * the same link cannot set a password twice.
 */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  const store = accountStore();

  const user = await verifyPasswordResetToken(token, (id) => store.findById(id));
  if (!user) return false;

  await store.update(user.id, { password: await hash.make(password) });
  return true;
}

/* --------------------------- email verification --------------------------- */

export async function sendVerificationEmail(user: AccountUser): Promise<void> {
  const config = resolveConfig();

  const token = await emailVerificationToken(user, config.verification.expiresIn);
  const link = absolute(config.verification.url.replace(":token", encodeURIComponent(token)));

  const message = mail()
    .to(user.email)
    .subject("Confirm your email address")
    .html(`<p>Confirm your address to finish setting up your account.</p>
           <p><a href="${link}">Confirm ${user.email}</a></p>`);

  if (config.mail.from) message.from(config.mail.from);
  await message.send();
}

/** Mark the address proven. Idempotent — clicking the link twice is not an error. */
export async function verifyEmail(token: string): Promise<AccountUser | null> {
  const store = accountStore();

  const user = await verifyEmailToken(token, (id) => store.findById(id));
  if (!user) return null;

  if (!user.email_verified_at) {
    await store.update(user.id, { email_verified_at: new Date().toISOString() });
  }

  return user;
}

/* --------------------------------- helpers -------------------------------- */

/**
 * Leave absolute URLs alone; make relative ones absolute against `app.url`.
 *
 * Read through `config()`, not `process.env` — this module has to run on Workers,
 * where there is no `process`.
 */
function absolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  const base = config<string>("app.url", "http://localhost:3000").replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
