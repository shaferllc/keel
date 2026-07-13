import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

import { Application } from "../src/core/application.js";
import { setConnection, clearConnections, connection, db } from "../src/core/database.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";
import { hash } from "../src/core/crypto.js";
import { fakeMail, restoreMail } from "../src/core/mail.js";

import { accountsMigration } from "../src/accounts/migration.js";
import { setAccountStore, tableStore, accountStore } from "../src/accounts/store.js";
import type { AccountUser } from "../src/accounts/store.js";
import {
  attempt,
  completeTwoFactor,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
} from "../src/accounts/flows.js";
import {
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  hasTwoFactor,
  recoveryCodesRemaining,
  redeemRecoveryCode,
  regenerateRecoveryCodes,
} from "../src/accounts/two-factor.js";
import { passwordResetToken, verifyPasswordResetToken } from "../src/accounts/tokens.js";
import { base32Encode, totp, verifyTotp, otpauthUri, otpauthQrSvg, otpauthQrDataUrl } from "../src/accounts/totp.js";

/* ---------------------------------- setup --------------------------------- */

/** A real app, a real database — these flows are only interesting end-to-end. */
async function boot(): Promise<void> {
  clearConnections();

  const client = createClient({ url: ":memory:" });
  setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");

  const app = new Application();
  await app.boot([], {
    discoverConfig: false,
    // app.key is what `encryption` signs with; every token here depends on it.
    config: { app: { key: "test-key-0123456789abcdef", url: "https://app.test" } },
  });

  await connection().write(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)",
    [],
  );

  // The module's own migration adds the columns it needs — exercise it, don't
  // hand-write the schema, or the migration is never tested.
  const migration = accountsMigration("users");
  await migration.up({
    raw: (sql: string) => connection().write(sql, []),
  } as never);

  setAccountStore(tableStore("users"));
}

async function makeUser(email = "ada@example.com", password = "correct horse"): Promise<AccountUser> {
  await db("users").insert({ email, password: await hash.make(password) });
  return (await accountStore().findByEmail(email))!;
}

/* ---------------------------------- totp ---------------------------------- */

// RFC 6238 Appendix B. If these ever fail, every authenticator app on earth
// disagrees with us and 2FA is broken.
test("TOTP matches the RFC 6238 test vectors", async () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));

  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"], // counter beyond 2^32 — the 64-bit path
  ];

  for (const [timestamp, expected] of vectors) {
    assert.equal(await totp(secret, { digits: 8, timestamp }), expected, `T=${timestamp}`);
  }
});

test("a code from one period either side still verifies; a stale one doesn't", async () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  const now = 1111111109;

  const previous = await totp(secret, { timestamp: now - 30 });
  assert.equal(await verifyTotp(secret, previous, { timestamp: now }), true);

  const stale = await totp(secret, { timestamp: now - 300 });
  assert.equal(await verifyTotp(secret, stale, { timestamp: now }), false);

  assert.equal(await verifyTotp(secret, "000000", { timestamp: now }), false);
  assert.equal(await verifyTotp(secret, "nonsense", { timestamp: now }), false);
});

test("the otpauth URI carries the secret — so it must never leave the server", () => {
  const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "ada@x.com", issuer: "Acme" });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=Acme/);

  const svg = otpauthQrSvg(uri);
  assert.match(svg, /<svg[\s\S]*<\/svg>/);
  assert.match(otpauthQrDataUrl(uri), /^data:image\/svg\+xml/);
});

/* ---------------------------------- login --------------------------------- */

test("a good password logs in; a bad one gives nothing away", async () => {
  await boot();
  await makeUser();

  const ok = await attempt("ada@example.com", "correct horse");
  assert.equal(ok.status, "ok");

  assert.equal((await attempt("ada@example.com", "wrong")).status, "failed");
  // A user who doesn't exist is the same answer as a wrong password.
  assert.equal((await attempt("nobody@example.com", "correct horse")).status, "failed");
});

test("with 2FA on, a correct password returns a challenge — NOT a session", async () => {
  await boot();
  const user = await makeUser();

  const setup = await enableTwoFactor(user);
  const fresh = (await accountStore().findByEmail(user.email))!;
  await confirmTwoFactor(fresh, await totp(setup.secret));

  const result = await attempt("ada@example.com", "correct horse");

  // The whole point: the password alone yields a challenge, and nothing else.
  assert.equal(result.status, "two-factor");
  assert.ok(result.status === "two-factor" && result.challenge.length > 0);
});

test("the challenge is spent by a real code, and rejects a wrong one", async () => {
  await boot();
  const user = await makeUser();

  const setup = await enableTwoFactor(user);
  await confirmTwoFactor((await accountStore().findByEmail(user.email))!, await totp(setup.secret));

  const result = await attempt("ada@example.com", "correct horse");
  assert.equal(result.status, "two-factor");
  const challenge = result.status === "two-factor" ? result.challenge : "";

  assert.equal(await completeTwoFactor(challenge, "000000"), null);

  const logged = await completeTwoFactor(challenge, await totp(setup.secret));
  assert.ok(logged, "a valid code completes the login");
  assert.equal(logged?.email, "ada@example.com");
});

test("a challenge can't be forged, and isn't interchangeable with a reset token", async () => {
  await boot();
  const user = await makeUser();
  const setup = await enableTwoFactor(user);
  await confirmTwoFactor((await accountStore().findByEmail(user.email))!, await totp(setup.secret));

  assert.equal(await completeTwoFactor("not-a-token", await totp(setup.secret)), null);

  // A password-reset token is minted for a different purpose, so it must not
  // decrypt as a 2FA challenge — purposes are what stop tokens being swapped.
  const reset = await passwordResetToken(user);
  assert.equal(await completeTwoFactor(reset, await totp(setup.secret)), null);
});

/* ------------------------------- two factor ------------------------------- */

test("enabling 2FA does NOT turn it on — a working code does", async () => {
  await boot();
  const user = await makeUser();

  const setup = await enableTwoFactor(user);
  assert.ok(setup.secret);
  assert.equal(setup.recoveryCodes.length, 8);

  // Enabled but unconfirmed: still off, so a bad scan can't lock anyone out.
  let fresh = (await accountStore().findByEmail(user.email))!;
  assert.equal(hasTwoFactor(fresh), false);
  assert.equal((await attempt(user.email, "correct horse")).status, "ok");

  // A wrong code doesn't turn it on either.
  assert.equal(await confirmTwoFactor(fresh, "000000"), false);
  fresh = (await accountStore().findByEmail(user.email))!;
  assert.equal(hasTwoFactor(fresh), false);

  assert.equal(await confirmTwoFactor(fresh, await totp(setup.secret)), true);
  fresh = (await accountStore().findByEmail(user.email))!;
  assert.equal(hasTwoFactor(fresh), true);
});

test("the TOTP secret is encrypted at rest, and recovery codes are hashed", async () => {
  await boot();
  const user = await makeUser();
  const setup = await enableTwoFactor(user);

  const row = (await db("users").where("id", user.id).first())!;

  // A database leak must not hand over the second factor.
  assert.notEqual(row.two_factor_secret, setup.secret);
  assert.ok(!String(row.two_factor_secret).includes(setup.secret));

  // ...nor the backdoor.
  const stored = String(row.two_factor_recovery_codes);
  for (const code of setup.recoveryCodes) assert.ok(!stored.includes(code));
});

test("a recovery code works once, and only once", async () => {
  await boot();
  const user = await makeUser();
  const setup = await enableTwoFactor(user);
  await confirmTwoFactor((await accountStore().findByEmail(user.email))!, await totp(setup.secret));

  const code = setup.recoveryCodes[0]!;
  const result = await attempt(user.email, "correct horse");
  const challenge = result.status === "two-factor" ? result.challenge : "";

  const logged = await completeTwoFactor(challenge, code);
  assert.ok(logged, "a recovery code completes the login");

  // Burned. Someone reading it over your shoulder gets a code you already spent.
  const again = await attempt(user.email, "correct horse");
  const second = again.status === "two-factor" ? again.challenge : "";
  assert.equal(await completeTwoFactor(second, code), null);

  assert.equal(await recoveryCodesRemaining((await accountStore().findById(user.id))!), 7);
});

test("regenerating recovery codes invalidates the old ones", async () => {
  await boot();
  const user = await makeUser();
  const setup = await enableTwoFactor(user);

  const fresh = await regenerateRecoveryCodes((await accountStore().findById(user.id))!);
  assert.equal(fresh.length, 8);

  const reloaded = (await accountStore().findById(user.id))!;
  assert.equal(await redeemRecoveryCode(reloaded, setup.recoveryCodes[0]!), false);
  assert.equal(await redeemRecoveryCode(reloaded, fresh[0]!), true);
});

test("disabling 2FA destroys the secret and the codes", async () => {
  await boot();
  const user = await makeUser();
  const setup = await enableTwoFactor(user);
  await confirmTwoFactor((await accountStore().findByEmail(user.email))!, await totp(setup.secret));

  await disableTwoFactor((await accountStore().findById(user.id))!);

  const row = (await db("users").where("id", user.id).first())!;
  assert.equal(row.two_factor_secret, null);
  assert.equal(row.two_factor_recovery_codes, null);
  assert.equal(row.two_factor_confirmed_at, null);

  assert.equal((await attempt(user.email, "correct horse")).status, "ok");
});

/* ------------------------------ password reset ---------------------------- */

test("a reset link changes the password — once", async () => {
  await boot();
  const user = await makeUser();

  const token = await passwordResetToken(user);
  assert.equal(await resetPassword(token, "new password"), true);

  assert.equal((await attempt(user.email, "new password")).status, "ok");
  assert.equal((await attempt(user.email, "correct horse")).status, "failed");

  // The token is bound to the old password hash, so spending it kills it. No
  // tokens table, no cleanup job — the link in the inbox is simply dead.
  assert.equal(await resetPassword(token, "third password"), false);
  assert.equal((await attempt(user.email, "third password")).status, "failed");
});

test("a reset token is rejected when forged, and can't be spent as a verification link", async () => {
  await boot();
  const user = await makeUser();

  assert.equal(await resetPassword("garbage", "new password"), false);

  // Wrong purpose: a verification token must not reset a password.
  const store = accountStore();
  const verification = await (
    await import("../src/accounts/tokens.js")
  ).emailVerificationToken(user);
  assert.equal(await resetPassword(verification, "new password"), false);

  // ...and the reverse.
  const reset = await passwordResetToken(user);
  assert.equal(await verifyEmail(reset), null);

  assert.ok(await verifyPasswordResetToken(reset, (id) => store.findById(id)));
});

test("an expired reset token is refused", async () => {
  await boot();
  const user = await makeUser();

  const token = await passwordResetToken(user, -1); // already expired
  assert.equal(await resetPassword(token, "new password"), false);
});

test("forgot-password emails a link — and says nothing about who exists", async () => {
  await boot();
  const mailbox = fakeMail();

  await makeUser();

  await requestPasswordReset("ada@example.com");
  assert.equal(mailbox.sent().length, 1);
  assert.match(mailbox.sent()[0]!.html ?? "", /https:\/\/app\.test\/reset-password\?token=/);

  // An address with no account: no mail, no error, no signal.
  await requestPasswordReset("nobody@example.com");
  assert.equal(mailbox.sent().length, 1);

  restoreMail();
});

/* --------------------------- email verification --------------------------- */

test("a verification link proves the address, and is idempotent", async () => {
  await boot();
  const mailbox = fakeMail();
  const user = await makeUser();

  await sendVerificationEmail(user);
  assert.equal(mailbox.sent().length, 1);

  const token = /token=([^"&]+)/.exec(mailbox.sent()[0]!.html ?? "")![1]!;
  const verified = await verifyEmail(decodeURIComponent(token));

  assert.ok(verified);
  assert.ok((await accountStore().findById(user.id))!.email_verified_at);

  // Clicking twice is not an error.
  assert.ok(await verifyEmail(decodeURIComponent(token)));

  restoreMail();
});

test("a verification link is bound to the address it was sent to", async () => {
  await boot();
  const user = await makeUser();

  const { emailVerificationToken } = await import("../src/accounts/tokens.js");
  const token = await emailVerificationToken(user);

  // The user changes their email after the link was sent. The old link must not
  // mark the new address as proven — otherwise you verify an address you never
  // controlled by clicking a link sent to one you did.
  await accountStore().update(user.id, { email: "someone.else@example.com" });

  assert.equal(await verifyEmail(token), null);
});
