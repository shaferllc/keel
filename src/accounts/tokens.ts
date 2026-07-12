/**
 * The tokens behind password reset, email verification, and the 2FA challenge.
 *
 * There is no tokens table. Keel's `encryption` already carries a **purpose** and
 * an **expiry inside the ciphertext**, and `decrypt` returns `null` — never throws
 * — when either is wrong. So a token is self-describing: nothing to store, nothing
 * to clean up, and no window where a stale row is still redeemable because a cron
 * job didn't run.
 *
 * `purpose` is what stops a token minted for one thing being spent on another. A
 * verification link cannot be replayed as a password reset, because it will not
 * decrypt under that purpose. Every token here gets its own.
 *
 * The interesting problem is **single use**. A stateless token is, by nature,
 * replayable until it expires — so a reset link sitting in an inbox (or a proxy
 * log, or a browser history) would work twice. The fix is to bind the token to
 * something that *changes when it's spent*: the user's current password hash. Once
 * the password is reset, the hash is different, the fingerprint no longer matches,
 * and every token minted against the old one is dead. Single use, no storage.
 */

import { encryption } from "../core/crypto.js";
import type { AccountUser } from "./store.js";

export const PURPOSE = {
  passwordReset: "accounts:password-reset",
  emailVerification: "accounts:email-verification",
  twoFactorChallenge: "accounts:2fa-challenge",
} as const;

/* ------------------------------ password reset ---------------------------- */

interface ResetPayload {
  id: string | number;
  /** Fingerprint of the password the token was minted against. */
  fp: string;
}

/**
 * A reset token for this user. Dies on use (the password changes, so the
 * fingerprint stops matching) and dies on expiry, whichever comes first.
 */
export async function passwordResetToken(
  user: AccountUser,
  expiresIn: number | string = "60m",
): Promise<string> {
  const payload: ResetPayload = { id: user.id, fp: await fingerprint(user.password) };
  return encryption.encrypt(payload, { purpose: PURPOSE.passwordReset, expiresIn });
}

/**
 * The user this token resets, or `null` — expired, tampered with, minted for a
 * different purpose, or already spent.
 */
export async function verifyPasswordResetToken(
  token: string,
  find: (id: string | number) => Promise<AccountUser | null>,
): Promise<AccountUser | null> {
  const payload = await encryption.decrypt<ResetPayload>(token, {
    purpose: PURPOSE.passwordReset,
  });
  if (!payload) return null;

  const user = await find(payload.id);
  if (!user) return null;

  // The password has changed since this was minted — so the token has been spent,
  // or the user reset it another way. Either way it is not valid twice.
  if ((await fingerprint(user.password)) !== payload.fp) return null;

  return user;
}

/* --------------------------- email verification --------------------------- */

interface VerifyPayload {
  id: string | number;
  /** The address being proven. */
  email: string;
}

export async function emailVerificationToken(
  user: AccountUser,
  expiresIn: number | string = "24h",
): Promise<string> {
  const payload: VerifyPayload = { id: user.id, email: user.email.toLowerCase() };
  return encryption.encrypt(payload, { purpose: PURPOSE.emailVerification, expiresIn });
}

/**
 * The user this token verifies, or `null`.
 *
 * The address is baked in, so a link sent to the old address cannot verify a new
 * one — otherwise changing your email to someone else's and clicking an older link
 * would mark *their* address as proven.
 */
export async function verifyEmailToken(
  token: string,
  find: (id: string | number) => Promise<AccountUser | null>,
): Promise<AccountUser | null> {
  const payload = await encryption.decrypt<VerifyPayload>(token, {
    purpose: PURPOSE.emailVerification,
  });
  if (!payload) return null;

  const user = await find(payload.id);
  if (!user) return null;
  if (user.email.toLowerCase() !== payload.email) return null;

  return user;
}

/* ----------------------------- 2FA challenge ------------------------------ */

interface ChallengePayload {
  id: string | number;
}

/**
 * Proof that someone got the password right — and **nothing more**.
 *
 * This is deliberately not a session. The usual implementation logs the user in
 * and sets a `needs_2fa` flag for middleware to check, which means they hold a
 * real authenticated session before the second factor: every route that forgets
 * the middleware, and every `auth()` that only asks "is anyone logged in?", is
 * bypassable with just a password. Here, nothing is logged in until the code
 * verifies, so there is no half-authenticated state to forget about.
 *
 * Short-lived on purpose: it is the window in which a stolen password is enough.
 */
export async function twoFactorChallenge(
  user: AccountUser,
  expiresIn: number | string = "5m",
): Promise<string> {
  const payload: ChallengePayload = { id: user.id };
  return encryption.encrypt(payload, { purpose: PURPOSE.twoFactorChallenge, expiresIn });
}

/** Who this challenge is for, or `null` if it's expired, forged, or not a challenge. */
export async function verifyTwoFactorChallenge(
  token: string,
  find: (id: string | number) => Promise<AccountUser | null>,
): Promise<AccountUser | null> {
  const payload = await encryption.decrypt<ChallengePayload>(token, {
    purpose: PURPOSE.twoFactorChallenge,
  });
  if (!payload) return null;

  return find(payload.id);
}

/* --------------------------------- helpers -------------------------------- */

/**
 * A short digest of the stored password hash. Not a secret — it only ever travels
 * inside an already-encrypted payload — it just has to *change* when the password
 * does. A user with no password (social login) still gets a stable fingerprint.
 */
async function fingerprint(password: string | null | undefined): Promise<string> {
  const bytes = new TextEncoder().encode(password ?? "");
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
