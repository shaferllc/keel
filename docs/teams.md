# Teams

Multi-tenancy, membership, roles, and invitations — where a row belongs to a team,
and one team can never see another's.

```ts
// bootstrap/providers.ts
import { TeamsServiceProvider } from "@shaferllc/keel/teams";

app.register(TeamsServiceProvider);
```

```ts
// app/Http/Kernel.ts
import { teamContext } from "@shaferllc/keel/teams";

protected middleware = [sessionMiddleware(), teamContext()];
```

Then a tenant-owned model is one word:

```ts
import { TenantModel } from "@shaferllc/keel/teams";

class Post extends TenantModel {
  static table = "posts";
}

await Post.all();                     // only the current team's posts
await Post.create({ title: "Hi" });   // stamped with the current team
```

## Isolation is the default, not a habit

Two halves, and both matter.

**Reads** are constrained by a global scope on `TenantModel`, so every query the
model builds carries the team — including `find()`. Naming another team's row by its
id returns `null`, not that row. This is the difference between tenancy and a list
filter: a filter you forget on one endpoint is a leak; a scope you never write can't
be forgotten.

**Writes** are stamped by a `creating` hook, so a row cannot be born ownerless and
end up visible to everyone (or to no one).

## No team means an error, not "everything"

A queued job, a console command, a webhook, a seeder — none of them run inside a
request, so none of them have a team. **A tenant query there throws.**

```ts
await Post.all();
// Error: No team in context, so a tenant-scoped query can't be built safely.
//   Inside a request, add teamContext() to your middleware.
//   In a job, command, or seeder, wrap the work: runForTeam(team, () => …).
//   If it genuinely spans every team, say so: withoutTenant(() => …).
```

This is the security model, and the alternatives are worse:

| If no team meant… | Then |
| --- | --- |
| *unscoped* | every background job sees every tenant's rows — this is how customer A's invoice reaches customer B |
| `teamId = NULL` | jobs match nothing, "work" fine, and quietly do nothing for a month |
| **an error** | a job that forgot **crashes in development** instead of leaking in production |

So a job says which team it's for:

```ts
await runForTeam(team, () => sendInvoices());
```

...or says, out loud, that it isn't for one:

```ts
await withoutTenant(() => Post.withoutGlobalScope(TENANT_SCOPE).get());
```

Both are named calls you can **grep for at audit time**. That's the point: crossing a
tenant boundary should be something you typed, never something you arrived at by
forgetting a `where`.

> Your jobs will crash until each one is wrapped. That friction is the feature — it
> is a loud failure in development in exchange for not having a silent one in
> production.

The context lives in `AsyncLocalStorage`, not a module global, so two concurrent
requests can't see each other's team.

## Teams and membership

```ts
const team = await createTeam("Acme", user.id);   // creator becomes the owner

await teamsFor(user.id);            // the teams a user is in
await roleOf(user.id, team.id);     // "owner" | "admin" | "member" | null
await memberOf(user.id, team.id, "admin");
await switchTeam(user.id, team.id); // false if they aren't a member
```

A user is in a team **if and only if a membership row says so**. `teams.owner_id` is a
convenience, not an authorization source.

`switchTeam()` verifies membership, and so does `teamContext()` on every request —
`users.current_team_id` is just a number on a row the user can influence, so it is
checked, never trusted. Without that, switching teams would be a matter of writing
someone else's id onto your own row.

`Team` and `Membership` are deliberately **not** tenant-scoped: "which teams am I in?"
is a question you have to answer *before* you know which team you're in.

## Roles

`owner` > `admin` > `member`, ordered — an owner can do anything an admin can.

```ts
router.delete("/posts/:post", …).middleware(requireRole("admin"));
```

```ts
roleAtLeast("owner", "admin");   // true
roleAtLeast("member", "admin");  // false
```

## Invitations

```ts
const { token } = await invite(team.id, "grace@example.com", "admin");
await acceptInvitation(token, user.id, user.email);

await pendingInvitations(team.id);
await revokeInvitation(id);
```

Unlike a password-reset link, an invitation **is** a database row — it has to be
listable ("3 pending") and revocable, and you can't revoke a stateless token. Only the
token's **hash** is stored, so a database leak doesn't open every pending team.

The invited address is re-checked on accept, so a **forwarded link doesn't let someone
else join** in the invitee's place — which is the interesting attack on an invitation
system. Invitations are single-use, expire (72h by default), and re-inviting the same
address replaces the outstanding invitation rather than stacking duplicates.

## Personal teams

On by default: every new user gets a team of their own, and a solo user is simply a
team of one.

Worth leaving on even for an app that feels single-user. **Tenancy is not a feature
you can add later** — bolting a `team_id` onto a schema that already has customer data
means a backfill, a migration on every table, and rewriting every query. Ignoring a
team you have costs one unused row. Needing a team you don't have costs a weekend.

## Configuration

```bash
keel vendor:publish --tag teams-config
```

```ts
export default {
  userTable: "users",
  personalTeams: true,
  invitations: { expiresInHours: 72, url: "/invitations/:token" },
};
```

## The schema

| Table | |
| --- | --- |
| `teams` | name, slug, owner_id |
| `team_memberships` | team_id, user_id, role — **unique per (team, user)**, enforced by the database |
| `team_invitations` | team_id, email, role, token **hash**, expires_at |

Plus `current_team_id` on your users table.
