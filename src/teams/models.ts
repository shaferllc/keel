/**
 * Teams and membership.
 *
 * These are plain models, deliberately **not** `TenantModel` — the tenant scope
 * constrains queries to the current team, and you have to be able to ask "which
 * teams does this user belong to?" *before* you know which team you're in.
 */

import { Model } from "../core/model.js";
import { db } from "../core/database.js";

/** Who can do what. Ordered: an owner can do anything an admin can, and so on. */
export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

/** Does `role` carry at least the authority of `needed`? */
export function roleAtLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

export class Team extends Model {
  static override table = "teams";
  static override fillable = ["name", "slug", "owner_id"];
  static override timestamps = true;

  declare id: number;
  declare name: string;
  declare slug: string;
  declare owner_id: number;

  /** Everyone in this team, with their role. */
  async members(): Promise<Membership[]> {
    const rows = await db(Membership.table).where("team_id", this.id).get();
    return rows.map((row) => new Membership(row));
  }
}

export class Membership extends Model {
  static override table = "team_memberships";
  static override fillable = ["team_id", "user_id", "role"];
  static override timestamps = true;

  declare id: number;
  declare team_id: number;
  declare user_id: number;
  declare role: Role;
}

/* --------------------------------- lookups -------------------------------- */

/** The teams a user belongs to. */
export async function teamsFor(userId: string | number): Promise<Team[]> {
  const memberships = await db(Membership.table).where("user_id", userId).get();
  if (!memberships.length) return [];

  const ids = memberships.map((m) => m.team_id);
  const rows = await db(Team.table).whereIn("id", ids as never[]).get();
  return rows.map((row) => new Team(row));
}

/** A user's role in a team, or `null` if they aren't in it. */
export async function roleOf(
  userId: string | number,
  teamId: string | number,
): Promise<Role | null> {
  const row = await db(Membership.table).where("user_id", userId).where("team_id", teamId).first();
  return row ? (row.role as Role) : null;
}

/** Is this user in this team, at least at this level? */
export async function memberOf(
  userId: string | number,
  teamId: string | number,
  atLeast: Role = "member",
): Promise<boolean> {
  const role = await roleOf(userId, teamId);
  return role ? roleAtLeast(role, atLeast) : false;
}

/**
 * Create a team and make its creator the owner.
 *
 * The membership row is what actually grants access — `teams.owner_id` alone would
 * leave the owner out of every membership query.
 */
export async function createTeam(
  name: string,
  ownerId: string | number,
  slug?: string,
): Promise<Team> {
  const team = await Team.create({
    name,
    slug: slug ?? slugify(name),
    owner_id: ownerId,
  });

  await Membership.create({ team_id: team.id, user_id: ownerId, role: "owner" });
  return team as Team;
}

/**
 * Switch which team a user is acting as — **only** to a team they're actually in.
 *
 * The check is the point. `current_team_id` is a number on the user's own row; if
 * switching didn't verify membership, changing teams would just be a matter of
 * writing someone else's id into it.
 */
export async function switchTeam(
  userId: string | number,
  teamId: string | number,
  userTable = "users",
): Promise<boolean> {
  if (!(await memberOf(userId, teamId))) return false;

  await db(userTable).where("id", userId).update({ current_team_id: teamId });
  return true;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
