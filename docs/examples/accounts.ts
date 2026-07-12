// Typechecked example for docs/accounts.md.
import { Application } from "@shaferllc/keel/core";
import {
  AccountsServiceProvider,
  attempt,
  completeTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  hasTwoFactor,
  regenerateRecoveryCodes,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
  accountStore,
  setAccountStore,
  type AccountUser,
} from "@shaferllc/keel/accounts";

const app = new Application();

/* ------------------------------- turning it on ---------------------------- */

app.register(AccountsServiceProvider);

/* ---------------------------------- login --------------------------------- */

async function login(email: string, password: string) {
  const result = await attempt(email, password);

  if (result.status === "failed") {
    return { error: "Those credentials don't match." };
  }

  if (result.status === "two-factor") {
    // Nothing is logged in yet. Hold the challenge, ask for a code.
    return { twoFactor: true, challenge: result.challenge };
  }

  return { user: result.user };
}

async function finishTwoFactor(challenge: string, code: string) {
  // Takes an authenticator code or a recovery code.
  const user = await completeTwoFactor(challenge, code);
  if (!user) return { error: "That code isn't valid." };

  return { user };
}

/* ------------------------------ password reset ---------------------------- */

async function forgot(email: string) {
  await requestPasswordReset(email);
  // Always the same answer, whether or not that address has an account.
  return { status: "If that address has an account, a link is on its way." };
}

async function reset(token: string, password: string) {
  const ok = await resetPassword(token, password);
  return ok ? { status: "Password reset." } : { error: "That link is invalid or expired." };
}

/* --------------------------- email verification --------------------------- */

async function afterRegistration(user: AccountUser) {
  await sendVerificationEmail(user);
}

async function confirmEmail(token: string) {
  const user = await verifyEmail(token);
  return user ? { status: "Confirmed." } : { error: "That link is invalid or expired." };
}

/* -------------------------------- two factor ------------------------------ */

async function startTwoFactor(user: AccountUser) {
  // Step one: a secret and recovery codes — but 2FA is NOT on yet.
  const setup = await enableTwoFactor(user, { issuer: "Acme" });

  // Render setup.uri to a QR code locally. It contains the secret; never send it
  // to a third-party QR service.
  return {
    uri: setup.uri,
    secret: setup.secret,
    recoveryCodes: setup.recoveryCodes, // shown once
  };
}

async function finishSetup(user: AccountUser, code: string) {
  // Step two: a working code turns it on. Without this, a bad scan locks them out.
  const ok = await confirmTwoFactor(user, code);
  return ok ? { status: "Two-factor is on." } : { error: "That code isn't valid." };
}

async function accountSettings(user: AccountUser) {
  return {
    twoFactorEnabled: hasTwoFactor(user),
  };
}

async function newCodes(user: AccountUser) {
  return regenerateRecoveryCodes(user); // invalidates the old set
}

async function turnOff(user: AccountUser) {
  await disableTwoFactor(user);
}

/* ------------------------------ a custom store ---------------------------- */

// Users somewhere other than a `users` table? Replace the whole store. (Anything
// that can find a user and update one will do — here, a map.)
const people = new Map<string | number, AccountUser>();

setAccountStore({
  async findById(id) {
    return people.get(id) ?? null;
  },
  async findByEmail(email) {
    for (const person of people.values()) {
      if (person.email === email.toLowerCase()) return person;
    }
    return null;
  },
  async update(id, values) {
    const person = people.get(id);
    if (person) people.set(id, { ...person, ...values });
  },
});

// The store the rest of the module reads through.
const store = accountStore();

export {
  login,
  finishTwoFactor,
  forgot,
  reset,
  afterRegistration,
  confirmEmail,
  startTwoFactor,
  finishSetup,
  accountSettings,
  newCodes,
  turnOff,
  app,
  store,
};
