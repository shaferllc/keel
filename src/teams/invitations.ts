/**
 * Team invitations.
 *
 * Unlike password reset, an invitation **is** a database row — because it has to be
 * listable ("3 pending invites") and revocable, and you can't revoke a stateless
 * token. What isn't stored is the token itself: only its hash, so a leaked database
 * doesn't let someone walk into every pending team.
 *
 * The email is baked into the invitation and re-checked on accept, so a forwarded
 * link doesn't let a different person join in the invitee's place.
 */

import { db } from "../core/database.js";
import { hash } from "../core/crypto.js";
import { config } from "../core/helpers.js";
import { mail } from "../core/mail.js";

import { Membership, Team, type Role } from "./models.js";
import { resolveConfig } from "./config.js";

export interface Invitation {
  id: number;
  team_id: number;
  email: string;
  role: Role;
  expires_at: string;
}

export interface SentInvitation {
  invitation: Invitation;
  /** The plaintext token — it goes in the email and is never stored. */
  token: string;
}

/** Invite someone to a team. Returns the token so a caller can build its own link. */
export async function invite(
  teamId: string | number,
  email: string,
  role: Role = "member",
): Promise<SentInvitation> {
  const settings = resolveConfig();
  const address = email.toLowerCase();

  // Re-inviting replaces the outstanding invitation rather than stacking duplicates.
  await db("team_invitations").where("team_id", teamId).where("email", address).delete();

  const token = randomToken();
  const expires = new Date(Date.now() + settings.invitations.expiresInHours * 3_600_000);

  const id = await db("team_invitations").insertGetId({
    team_id: teamId,
    email: address,
    role,
    // Only the hash. The token exists in the email and nowhere else.
    token: await hash.make(token),
    expires_at: expires.toISOString(),
    created_at: new Date().toISOString(),
  });

  const invitation: Invitation = {
    id: Number(id),
    team_id: Number(teamId),
    email: address,
    role,
    expires_at: expires.toISOString(),
  };

  await sendInvitationEmail(invitation, token);
  return { invitation, token };
}

/** Outstanding invitations for a team. */
export async function pendingInvitations(teamId: string | number): Promise<Invitation[]> {
  const rows = await db("team_invitations").where("team_id", teamId).get();
  return rows.map(toInvitation);
}

/** Withdraw an invitation. */
export async function revokeInvitation(id: string | number): Promise<void> {
  await db("team_invitations").where("id", id).delete();
}

/**
 * Accept an invitation, joining the team.
 *
 * `email` is the address of the person actually accepting — it must match the one
 * invited. Otherwise a forwarded link lets anyone join a team they were never asked
 * to, which is the interesting attack on an invitation system.
 */
export async function acceptInvitation(
  token: string,
  userId: string | number,
  email: string,
): Promise<Team | null> {
  const address = email.toLowerCase();

  const rows = await db("team_invitations").where("email", address).get();

  for (const row of rows) {
    if (!(await hash.verify(String(row.token), token))) continue;

    // Expired invitations are dead, and worth clearing out while we're here.
    if (new Date(String(row.expires_at)) < new Date()) {
      await db("team_invitations").where("id", row.id).delete();
      return null;
    }

    const existing = await db(Membership.table)
      .where("team_id", row.team_id)
      .where("user_id", userId)
      .first();

    if (!existing) {
      await Membership.create({
        team_id: row.team_id,
        user_id: userId,
        role: row.role as Role,
      });
    }

    // Single use.
    await db("team_invitations").where("id", row.id).delete();

    const team = await db(Team.table).where("id", row.team_id).first();
    return team ? new Team(team) : null;
  }

  return null;
}

/* --------------------------------- internals ------------------------------ */

async function sendInvitationEmail(invitation: Invitation, token: string): Promise<void> {
  const settings = resolveConfig();

  const team = await db(Team.table).where("id", invitation.team_id).first();
  const link = absolute(settings.invitations.url.replace(":token", encodeURIComponent(token)));

  const message = mail()
    .to(invitation.email)
    .subject(`You've been invited to ${team?.name ?? "a team"}`)
    .html(
      `<p>You've been invited to join <strong>${team?.name ?? "a team"}</strong>.</p>` +
        `<p><a href="${link}">Accept the invitation</a></p>` +
        `<p>It expires in ${settings.invitations.expiresInHours} hours.</p>`,
    );

  if (settings.mail.from) message.from(settings.mail.from);
  await message.send();
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toInvitation(row: Record<string, unknown>): Invitation {
  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    email: String(row.email),
    role: row.role as Role,
    expires_at: String(row.expires_at),
  };
}

function absolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = config<string>("app.url", "http://localhost:3000").replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
