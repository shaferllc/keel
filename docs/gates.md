# Gates

Keel Gates is a **signup gate** for private alpha / waitlist apps: an email
allowlist, invite codes with use limits and expiry, and a single check that
answers "may this person register?". It ships as `@shaferllc/keel/gates`.

This is **not** authorization (`can` / policies in [authorization](./authorization.md))
and **not** team invitations ([teams](./teams.md)). Those answer different
questions. Gates answers only: *is this email allowed to create an account?*

## Install

```ts
// bootstrap/providers.ts
import { GatesServiceProvider } from "@shaferllc/keel/gates";

export const providers = [AppServiceProvider, GatesServiceProvider];
```

Then migrate — the provider contributes `invite_codes` and `email_allowlist`
tables (`CREATE TABLE IF NOT EXISTS`, so existing apps stay safe):

```bash
keel migrate
```

## Checking registration

```ts
import { canRegister, redeemInvite } from "@shaferllc/keel/gates";

const gate = await canRegister(email, inviteCode);
if (!gate.ok) {
  return json({ error: gate.reason }, 403);
}

// …create the user…

if (gate.via === "code" && gate.invite) {
  await redeemInvite(gate.invite); // increments uses
}
```

`canRegister` returns:

| Result | Meaning |
|--------|---------|
| `{ ok: true, via: "allowlist" }` | Email is on `email_allowlist` |
| `{ ok: true, via: "code", invite }` | Valid invite code (not expired, uses left) |
| `{ ok: false, reason }` | Rejected — show `reason` to the user |

Allowlist wins over codes: if the email is allowlisted, the code is ignored.

## Managing codes and allowlist

The models are ordinary Keel models — create rows from an admin UI or a seeder:

```ts
import { InviteCode, EmailAllowlist } from "@shaferllc/keel/gates";

await InviteCode.create({
  code: "ALPHA-42",
  max_uses: 10,
  uses: 0,
  expires_at: null,
});

await EmailAllowlist.create({ email: "ada@example.com" });
```

## Related

- [Accounts](./accounts.md) — register / login flows that call `canRegister` first
- [Teams](./teams.md) — invitations *into* a team, after the user already exists
- [Authorization](./authorization.md) — ability checks once they're signed in
