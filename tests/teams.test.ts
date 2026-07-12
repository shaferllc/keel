import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

import { Application } from "../src/core/application.js";
import { setConnection, clearConnections, connection, db } from "../src/core/database.js";
import { SchemaBuilder } from "../src/core/migrations.js";
import { libsqlConnection, type LibSqlLike } from "../src/db/libsql.js";
import { fakeMail, restoreMail } from "../src/core/mail.js";

import { teamsMigration } from "../src/teams/migration.js";
import { TenantModel, TENANT_SCOPE } from "../src/teams/tenant.js";
import { currentTeam, hasTeamContext, runForTeam, withoutTenant } from "../src/teams/context.js";
import {
  Membership,
  Team,
  createTeam,
  memberOf,
  roleAtLeast,
  roleOf,
  switchTeam,
  teamsFor,
} from "../src/teams/models.js";
import {
  acceptInvitation,
  invite,
  pendingInvitations,
  revokeInvitation,
} from "../src/teams/invitations.js";

/* ---------------------------------- setup --------------------------------- */

class Post extends TenantModel {
  static override table = "posts";
  static override fillable = ["title", "team_id"];

  declare id: number;
  declare title: string;
  declare team_id: number;
}

async function boot(): Promise<void> {
  clearConnections();

  const client = createClient({ url: ":memory:" });
  setConnection(libsqlConnection(client as unknown as LibSqlLike), "sqlite");

  const app = new Application();
  await app.boot([], {
    discoverConfig: false,
    config: { app: { key: "test-key-0123456789abcdef", url: "https://app.test" } },
  });

  await connection().write("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)", []);
  await connection().write(
    "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, team_id INTEGER)",
    [],
  );
  await connection().write("INSERT INTO users (id, email) VALUES (1,'ada@x.com'),(2,'grace@x.com')", []);

  // The real schema builder, so the migration itself is exercised — a hand-written
  // CREATE TABLE in the test would let the shipped migration rot untested.
  await teamsMigration("users").up(new SchemaBuilder(connection(), "sqlite"));
}

/* ----------------------------- isolation: reads --------------------------- */

test("a tenant model only ever sees the current team's rows", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  await db("posts").insert({ title: "Globex's", team_id: 2 });

  const acme = await runForTeam(1, () => Post.all());
  assert.deepEqual(acme.map((p) => p.title), ["Acme's"]);

  const globex = await runForTeam(2, () => Post.all());
  assert.deepEqual(globex.map((p) => p.title), ["Globex's"]);
});

test("naming another team's row by id doesn't reach it", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  const other = await db("posts").insertGetId({ title: "Globex's", team_id: 2 });

  // The scope is on every query, so `find` can't step around it. This is the
  // difference between tenancy and a list filter.
  const found = await runForTeam(1, () => Post.find(Number(other)));
  assert.equal(found, null);
});

/* ---------------------------- isolation: writes --------------------------- */

test("a row is stamped with the current team on create", async () => {
  await boot();

  const post = await runForTeam(2, () => Post.create({ title: "Written inside team 2" }));
  assert.equal(post.team_id, 2, "the creating hook stamps the tenant");

  // And it's genuinely invisible to the other team.
  assert.equal((await runForTeam(1, () => Post.all())).length, 0);
});

/* --------------------------- fail closed, not open ------------------------ */

/**
 * The whole security model. A job, a console command, a webhook — none run inside a
 * request. If a tenant query outside a team context returned *everything*, that is
 * how one customer's data reaches another. So it throws.
 */
test("a tenant query with NO team context throws — it does not return everything", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  await db("posts").insert({ title: "Globex's", team_id: 2 });

  assert.equal(hasTeamContext(), false);

  await assert.rejects(() => Post.all(), /No team in context/);
  await assert.rejects(() => Post.create({ title: "ownerless" }), /No team in context/);

  // Nothing was written by the failed create.
  const all = await withoutTenant(() => db("posts").get());
  assert.equal(all.length, 2);
});

test("the error tells you how to fix it", async () => {
  await boot();

  await assert.rejects(() => Post.all(), /runForTeam/);
  await assert.rejects(() => Post.all(), /withoutTenant/);
});

test("withoutTenant crosses teams — deliberately, and greppably", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  await db("posts").insert({ title: "Globex's", team_id: 2 });

  const every = await withoutTenant(() => Post.withoutGlobalScope(TENANT_SCOPE).get());
  assert.equal(every.length, 2);
});

test("runForTeam nests, and the context doesn't leak between teams", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  await db("posts").insert({ title: "Globex's", team_id: 2 });

  await runForTeam(1, async () => {
    assert.equal(currentTeam(), 1);
    assert.equal((await Post.all()).length, 1);

    await runForTeam(2, async () => {
      assert.equal(currentTeam(), 2);
      assert.deepEqual((await Post.all()).map((p) => p.title), ["Globex's"]);
    });

    // Back out to team 1 — the inner run must not have bled.
    assert.equal(currentTeam(), 1);
    assert.deepEqual((await Post.all()).map((p) => p.title), ["Acme's"]);
  });
});

test("concurrent teams don't see each other", async () => {
  await boot();
  await db("posts").insert({ title: "Acme's", team_id: 1 });
  await db("posts").insert({ title: "Globex's", team_id: 2 });

  // The reason context lives in AsyncLocalStorage rather than a module global.
  const [one, two] = await Promise.all([
    runForTeam(1, () => Post.all()),
    runForTeam(2, () => Post.all()),
  ]);

  assert.deepEqual(one.map((p) => p.title), ["Acme's"]);
  assert.deepEqual(two.map((p) => p.title), ["Globex's"]);
});

/* --------------------------------- membership ----------------------------- */

test("creating a team makes the creator its owner", async () => {
  await boot();

  const team = await createTeam("Acme", 1);
  assert.equal(team.name, "Acme");
  assert.equal(team.slug, "acme");

  // The membership row is what grants access — owner_id alone would leave the
  // owner out of every membership query.
  assert.equal(await roleOf(1, team.id), "owner");
  assert.equal(await memberOf(1, team.id, "owner"), true);
  assert.deepEqual((await teamsFor(1)).map((t) => t.name), ["Acme"]);
});

test("roles are ordered: an owner can do what an admin can", () => {
  assert.equal(roleAtLeast("owner", "admin"), true);
  assert.equal(roleAtLeast("admin", "member"), true);
  assert.equal(roleAtLeast("member", "admin"), false);
  assert.equal(roleAtLeast("admin", "owner"), false);
});

test("switching teams only works for a team you're actually in", async () => {
  await boot();

  const acme = await createTeam("Acme", 1);
  const globex = await createTeam("Globex", 2);

  assert.equal(await switchTeam(1, acme.id), true);

  // Ada is not in Globex. Without this check, changing teams would just be a
  // matter of writing someone else's id onto your own row.
  assert.equal(await switchTeam(1, globex.id), false);

  const user = await db("users").where("id", 1).first();
  assert.equal(user!.current_team_id, acme.id);
});

/* -------------------------------- invitations ----------------------------- */

test("an invitation is accepted once, and joins the team", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const { token } = await invite(team.id, "Grace@x.com", "admin");

  assert.equal(mailbox.sent().length, 1);
  assert.equal(mailbox.sent()[0]!.to[0], "grace@x.com");

  const joined = await acceptInvitation(token, 2, "grace@x.com");
  assert.ok(joined);
  assert.equal(await roleOf(2, team.id), "admin");

  // Single use.
  assert.equal(await acceptInvitation(token, 2, "grace@x.com"), null);

  restoreMail();
});

test("a forwarded invitation can't be redeemed by someone else", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const { token } = await invite(team.id, "grace@x.com");

  // The link is mailed to Grace. Someone else with the link is not Grace.
  assert.equal(await acceptInvitation(token, 2, "mallory@x.com"), null);
  assert.equal(await roleOf(2, team.id), null);

  // Grace herself still can.
  assert.ok(await acceptInvitation(token, 2, "grace@x.com"));

  restoreMail();
});

test("only the token's hash is stored", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const { token } = await invite(team.id, "grace@x.com");

  const row = await db("team_invitations").where("team_id", team.id).first();
  assert.notEqual(row!.token, token);
  assert.ok(!String(row!.token).includes(token));

  restoreMail();
});

test("an expired invitation is refused", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const { token, invitation } = await invite(team.id, "grace@x.com");

  await db("team_invitations")
    .where("id", invitation.id)
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() });

  assert.equal(await acceptInvitation(token, 2, "grace@x.com"), null);
  assert.equal(await roleOf(2, team.id), null);

  restoreMail();
});

test("invitations can be listed and revoked", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const { token, invitation } = await invite(team.id, "grace@x.com");

  assert.equal((await pendingInvitations(team.id)).length, 1);

  await revokeInvitation(invitation.id);
  assert.equal((await pendingInvitations(team.id)).length, 0);

  // Revoked means revoked — the emailed link is dead.
  assert.equal(await acceptInvitation(token, 2, "grace@x.com"), null);

  restoreMail();
});

test("re-inviting the same address replaces the invitation rather than stacking", async () => {
  await boot();
  const mailbox = fakeMail();

  const team = await createTeam("Acme", 1);
  const first = await invite(team.id, "grace@x.com", "member");
  const second = await invite(team.id, "grace@x.com", "admin");

  assert.equal((await pendingInvitations(team.id)).length, 1);

  // The superseded token is dead; the new one carries the new role.
  assert.equal(await acceptInvitation(first.token, 2, "grace@x.com"), null);
  assert.ok(await acceptInvitation(second.token, 2, "grace@x.com"));
  assert.equal(await roleOf(2, team.id), "admin");

  restoreMail();
});

/* ---------------------------- teams aren't tenant-scoped ------------------ */

test("Team and Membership are not tenant-scoped — you need them before you have a team", async () => {
  await boot();

  // No team context at all, and these must still work: "which teams am I in?" is
  // the question you ask *before* you know which team you're in.
  const team = await createTeam("Acme", 1);
  assert.ok(team.id);
  assert.equal((await Team.all()).length, 1);
  assert.equal((await Membership.all()).length, 1);
});
