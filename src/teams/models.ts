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
  let team: Team | undefined;

  // Retry on the unique index, don't just look before leaping.
  //
  // Picking a free slug with a SELECT is a check-then-act race: two people called
  // Ada signing up at the same moment both see "ada-s-team" is free, and one of them
  // gets a constraint error instead of an account. The index is the only real
  // arbiter, so the fix is to let it arbitrate and try again — not to look harder.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = slug ?? (await uniqueSlug(slugify(name)));

    try {
      team = (await Team.create({ name, slug: candidate, owner_id: ownerId })) as Team;
      break;
    } catch (error) {
      // An explicit slug was asked for and taken: that's the caller's problem.
      if (slug || !isUniqueViolation(error)) throw error;
    }
  }

  if (!team) throw new Error(`Could not find a free slug for "${name}".`);

  await Membership.create({ team_id: team.id, user_id: ownerId, role: "owner" });
  return team;
}

/** Every driver phrases it differently, and none of them agree on an error code. */
function isUniqueViolation(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);

  return (
    /unique/i.test(message) || // sqlite / libsql / d1
    /duplicate key/i.test(message) || // postgres
    /duplicate entry/i.test(message) // mysql
  );
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

/**
 * A slug nobody else has taken.
 *
 * `teams.slug` is unique, and personal teams are named after their owner — so two
 * people called Ada would collide and the second one's signup would 500. Names are
 * not unique and were never going to be; the slug has to make itself so.
 */
async function uniqueSlug(base: string): Promise<string> {
  const stem = base || "team";

  // The unique index is still the real guarantee; this just avoids the collision in
  // the common case rather than surfacing a constraint error to someone signing up.
  const taken = new Set(
    (await db(Team.table).where("slug", "like", `${stem}%`).get()).map((row) => String(row.slug)),
  );

  if (!taken.has(stem)) return stem;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  // A thousand teams called the same thing. Fine — stop counting.
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
