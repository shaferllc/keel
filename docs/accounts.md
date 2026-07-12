# Accounts

Password reset, email verification, and two-factor authentication — the flows every
app with a login needs, built on primitives already in core (`hash`, `encryption`,
`mail`, `rate-limit`).

They live in the framework, tested once, rather than being copy-pasted into each new
app. A password-reset flow written five times is four copies that quietly rot.

```bash
npm install @shaferllc/keel
```

```ts
// bootstrap/providers.ts
import { AccountsServiceProvider } from "@shaferllc/keel/accounts";

app.register(AccountsServiceProvider);
```

That merges config, adds four columns to your `users` table via a migration, and
mounts the JSON endpoints. **Views stay yours** — these are functions and JSON
endpoints; your controllers render the forms.

## Login

`attempt()` checks a password. What comes back depends on whether the user has 2FA.

```ts
const result = await attempt(email, password);

if (result.status === "failed") {
  return { error: "Those credentials don't match." };
}

if (result.status === "two-factor") {
  // Nothing is logged in yet. Hold the challenge, ask for a code.
  return { twoFactor: true, challenge: result.challenge };
}

auth().login(result.user.id);
```

A wrong email and a wrong password give the same answer, and take the same time —
`attempt()` hashes against `hash.dummy` when no user is found, because a fast "no
such user" tells an attacker which addresses are registered.

## Two-factor

### The challenge is not a session

When 2FA is on, a correct password yields a **challenge**, not a login. Nothing is
authenticated until the code verifies.

This matters more than it looks. The usual implementation logs the user in and sets a
`needs_2fa` flag for middleware to check — which means they are holding a real
authenticated session *before* the second factor. Every route that forgets the
middleware, and every `auth()` call that only asks "is anyone logged in?", is then
bypassable with just a password. The second factor becomes advisory.

Here there is no half-authenticated state to forget about, because there is no
session. The challenge is a short-lived token bound to a single purpose, so it cannot
be swapped for a session cookie or spent as a password-reset link.

```ts
const user = await completeTwoFactor(challenge, code);
if (!user) return { error: "That code isn't valid." };

auth().login(user.id);
```

`completeTwoFactor()` accepts an authenticator code **or** a recovery code.

### Turning it on takes two steps

```ts
// Step one: a secret and recovery codes. 2FA is NOT on yet.
const setup = await enableTwoFactor(user, { issuer: "Acme" });
```

`setup.uri` is an `otpauth://` URI to render as a QR code. `setup.secret` is for
manual entry. `setup.recoveryCodes` are shown **once**.

> Render the QR **locally**. The URI contains the shared secret, so posting it to a
> QR-image service hands your users' second factor to a third party.

```ts
// Step two: a working code turns it on.
const ok = await confirmTwoFactor(user, code);
```

The two-step dance is deliberate. A one-step "enable" locks out every user who scans
the QR wrong or whose phone clock is off — and what's broken is the very thing they'd
need to get back in. Until `confirmTwoFactor()` succeeds, `hasTwoFactor()` is false
and login works as before.

### Recovery codes

Eight by default, hashed at rest, single-use — redeeming one burns it, so a code read
over your shoulder is one you have already spent.

```ts
await recoveryCodesRemaining(user);       // worth surfacing when it gets low
await regenerateRecoveryCodes(user);      // invalidates the old set
await disableTwoFactor(user);             // destroys the secret and the codes
```

### What's stored

The TOTP secret is **encrypted** at rest and the recovery codes are **hashed**, so a
leaked database hands over neither the second factor nor the backdoor.

TOTP itself is RFC 6238, verified against the RFC's published test vectors, and built
on WebCrypto with no dependencies — so it runs unchanged on the edge.

## Password reset

```ts
await requestPasswordReset(email);   // emails a link, or quietly does nothing
```

The answer is the same whether or not that address has an account. "No account with
that address" is a free enumeration oracle on an unauthenticated endpoint that anyone
can ask about anyone.

```ts
const ok = await resetPassword(token, password);
```

**A reset link works exactly once**, and there is no `password_resets` table. The
token carries its own purpose and expiry inside the ciphertext, and it is bound to a
fingerprint of the current password hash — so the moment the password changes, every
token minted against the old one is dead. Nothing to store, nothing to clean up, and
no window where a stale row is still redeemable because a cron job didn't run.

## Email verification

```ts
await sendVerificationEmail(user);
const user = await verifyEmail(token);   // idempotent
```

The token is bound to the address it was sent to. A link mailed to an old address
cannot verify a new one — otherwise changing your email to someone else's and clicking
an older link would mark *their* address as proven.

## The endpoints

Mounted at `auth` unless you turn them off (`routes.enabled: false`) and call the
functions from your own controllers instead.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → a user, or `{ twoFactor, challenge }` |
| POST | `/auth/two-factor` | `{ challenge, code }` — code or recovery code |
| POST | `/auth/password/forgot` | Always `202`. Never says who exists. |
| POST | `/auth/password/reset` | `{ token, password }` |
| POST | `/auth/email/verify` | `{ token }` |
| POST | `/auth/email/resend` | Always `202` |

Every one is unauthenticated and touches credentials, so the group is rate-limited
(5 per minute by default). Without a throttle, a six-digit code inside a 30-second
window is guessable, and forgot-password is an email cannon pointed at whoever the
caller names.

## Configuration

```bash
keel vendor:publish --tag accounts-config
```

```ts
export default {
  userTable: "users",
  routes: { enabled: true, prefix: "auth" },
  passwordReset: { expiresIn: "60m", url: "/reset-password?token=:token" },
  verification: { expiresIn: "24h", url: "/verify-email?token=:token" },
  twoFactor: {
    issuer: env("APP_NAME", "Keel"),
    window: 1,               // ±30s of clock drift
    challengeExpiresIn: "5m",
    recoveryCodes: 8,
  },
  rateLimit: { max: 5, window: 60 },
};
```

`twoFactor.challengeExpiresIn` is the window in which a stolen password alone is
enough. Keep it short.

## A different users table

Accounts talks to a table through the query builder rather than assuming a `Model`.
If your users live somewhere else — an auth service, a legacy schema — replace the
store:

```ts
setAccountStore({
  async findById(id) { /* … */ },
  async findByEmail(email) { /* … */ },
  async update(id, values) { /* … */ },
});
```

## The schema

Four columns on your users table, and no tokens table:

| Column | |
| --- | --- |
| `email_verified_at` | null until proven |
| `two_factor_secret` | encrypted at rest |
| `two_factor_recovery_codes` | hashed, then encrypted |
| `two_factor_confirmed_at` | null until a working code proves it |
