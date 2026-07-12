/**
 * The two-factor lifecycle: enable, confirm, challenge, recover, disable.
 *
 * Enabling is **two steps on purpose**. `enableTwoFactor()` generates a secret and
 * stores it, but leaves `two_factor_confirmed_at` null — 2FA is not on yet. Only
 * `confirmTwoFactor()`, which requires a working code from the app, turns it on.
 * A one-step "enable" locks out every user who scans the QR wrong, mistypes the
 * secret, or has a phone whose clock is broken — and they cannot get back in,
 * because getting back in is exactly what's broken.
 *
 * The secret is encrypted at rest with its own purpose, so a leaked database does
 * not hand over everybody's second factor. Recovery codes are hashed, so a leaked
 * database does not hand over the backdoor either.
 */

import { hash, encryption } from "../core/crypto.js";

import { accountStore, type AccountUser } from "./store.js";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";

const SECRET_PURPOSE = "accounts:2fa-secret";

export interface TwoFactorSetup {
  /** The plaintext secret. Show it once, for manual entry. */
  secret: string;
  /** Render this to a QR code **locally** — it contains the secret. */
  uri: string;
  /** Show these once. They are hashed the moment they're stored. */
  recoveryCodes: string[];
}

export interface TwoFactorOptions {
  /** The name shown in the authenticator app. */
  issuer?: string;
  /** How many recovery codes to mint. */
  recoveryCodes?: number;
  window?: number;
}

/** Is two-factor actually on for this user — confirmed, not merely started? */
export function hasTwoFactor(user: AccountUser): boolean {
  return Boolean(user.two_factor_secret && user.two_factor_confirmed_at);
}

/**
 * Step one: mint a secret and recovery codes, and store them — but do **not** turn
 * 2FA on. The user has not proved they can generate a code yet.
 */
export async function enableTwoFactor(
  user: AccountUser,
  options: TwoFactorOptions = {},
): Promise<TwoFactorSetup> {
  const secret = generateSecret();
  const recoveryCodes = makeRecoveryCodes(options.recoveryCodes ?? 8);

  await accountStore().update(user.id, {
    two_factor_secret: await encryption.encrypt(secret, { purpose: SECRET_PURPOSE }),
    two_factor_recovery_codes: await encryption.encrypt(
      JSON.stringify(await Promise.all(recoveryCodes.map((code) => hash.make(code)))),
      { purpose: SECRET_PURPOSE },
    ),
    two_factor_confirmed_at: null,
  });

  return {
    secret,
    uri: otpauthUri({
      secret,
      account: user.email,
      issuer: options.issuer ?? "Keel",
    }),
    recoveryCodes,
  };
}

/**
 * Step two: a working code turns it on. Returns false if the code is wrong, and
 * 2FA stays off — which is the whole point of the two-step dance.
 */
export async function confirmTwoFactor(
  user: AccountUser,
  code: string,
  options: TwoFactorOptions = {},
): Promise<boolean> {
  const secret = await secretFor(user);
  if (!secret) return false;

  if (!(await verifyTotp(secret, code, { window: options.window ?? 1 }))) return false;

  await accountStore().update(user.id, {
    two_factor_confirmed_at: new Date().toISOString(),
  });
  return true;
}

/** Turn it off, and destroy the secret and the codes with it. */
export async function disableTwoFactor(user: AccountUser): Promise<void> {
  await accountStore().update(user.id, {
    two_factor_secret: null,
    two_factor_recovery_codes: null,
    two_factor_confirmed_at: null,
  });
}

/** Verify a code from the authenticator app. */
export async function verifyTwoFactorCode(
  user: AccountUser,
  code: string,
  options: TwoFactorOptions = {},
): Promise<boolean> {
  const secret = await secretFor(user);
  if (!secret) return false;

  return verifyTotp(secret, code, { window: options.window ?? 1 });
}

/**
 * Spend a recovery code. Single use: the code is removed on success, so the same
 * slip of paper cannot be used twice — and someone who reads it over your shoulder
 * gets one shot at a code you have already burned.
 */
export async function redeemRecoveryCode(user: AccountUser, code: string): Promise<boolean> {
  const codes = await recoveryCodesFor(user);
  if (!codes.length) return false;

  const supplied = code.trim().toLowerCase();

  for (const hashed of codes) {
    if (!(await hash.verify(hashed, supplied))) continue;

    const remaining = codes.filter((c) => c !== hashed);
    await accountStore().update(user.id, {
      two_factor_recovery_codes: await encryption.encrypt(JSON.stringify(remaining), {
        purpose: SECRET_PURPOSE,
      }),
    });
    return true;
  }

  return false;
}

/** How many recovery codes are left — worth showing when it gets low. */
export async function recoveryCodesRemaining(user: AccountUser): Promise<number> {
  return (await recoveryCodesFor(user)).length;
}

/** Mint a fresh set, invalidating the old ones. Shown once. */
export async function regenerateRecoveryCodes(
  user: AccountUser,
  count = 8,
): Promise<string[]> {
  const codes = makeRecoveryCodes(count);

  await accountStore().update(user.id, {
    two_factor_recovery_codes: await encryption.encrypt(
      JSON.stringify(await Promise.all(codes.map((code) => hash.make(code)))),
      { purpose: SECRET_PURPOSE },
    ),
  });

  return codes;
}

/* --------------------------------- internals ------------------------------ */

/** The decrypted TOTP secret, or null if 2FA was never set up. */
async function secretFor(user: AccountUser): Promise<string | null> {
  if (!user.two_factor_secret) return null;
  return encryption.decrypt<string>(user.two_factor_secret, { purpose: SECRET_PURPOSE });
}

async function recoveryCodesFor(user: AccountUser): Promise<string[]> {
  if (!user.two_factor_recovery_codes) return [];

  const json = await encryption.decrypt<string>(user.two_factor_recovery_codes, {
    purpose: SECRET_PURPOSE,
  });
  if (!json) return [];

  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Recovery codes people can actually read off paper and type back in: no vowels
 * (so no accidental words), no 0/1/l/o (so no ambiguity with O/I), grouped.
 */
function makeRecoveryCodes(count: number): string[] {
  const alphabet = "bcdfghjkmnpqrstvwxyz23456789";
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
    codes.push(`${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`);
  }

  return codes;
}
