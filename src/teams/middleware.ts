/**
 * Putting a request inside a team.
 *
 * `teamContext()` resolves which team the signed-in user is acting as and runs the
 * rest of the request inside it, so every `TenantModel` query is scoped without any
 * handler doing anything.
 *
 * The membership check is the security boundary. `users.current_team_id` is just a
 * number on a row the user can influence, so it is **verified against a membership**
 * on every request — not trusted. Otherwise switching teams is a matter of writing a
 * different id, and tenancy is decoration.
 */

import type { MiddlewareHandler } from "hono";

import { auth } from "../core/auth.js";
import { db } from "../core/database.js";
import { ForbiddenException } from "../core/exceptions.js";

import { runForTeam, withoutTenant } from "./context.js";
import { Membership, roleOf, teamsFor, type Role } from "./models.js";
import { resolveConfig } from "./config.js";

export interface TeamContextOptions {
  /**
   * What to do when a signed-in user has no team at all. `"error"` throws;
   * `"pass"` continues with no team context (so any TenantModel query will throw —
   * which is the right outcome for a route that shouldn't have needed one).
   */
  onMissing?: "error" | "pass";
}

/** Resolve the acting team and run the request inside it. */
export function teamContext(options: TeamContextOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const userId = auth().id();

    if (!userId) {
      // Nobody's signed in: no team, and no guessing. A tenant-scoped query on this
      // request will throw, which is what we want it to do.
      await next();
      return;
    }

    const teamId = await resolveTeam(userId);

    if (teamId === null) {
      if (options.onMissing === "error") {
        throw new ForbiddenException("You don't belong to any team.");
      }
      await next();
      return;
    }

    c.set("team_id", teamId);
    await runForTeam(teamId, () => next());
  };
}

/**
 * Require at least this role in the current team.
 *
 *   router.delete("/posts/:post", …).middleware(requireRole("admin"))
 */
export function requireRole(role: Role = "member"): MiddlewareHandler {
  return async (c, next) => {
    const userId = auth().id();
    const teamId = c.get("team_id");

    if (!userId || !teamId) throw new ForbiddenException("You don't belong to this team.");

    const actual = await withoutTenant(() => roleOf(userId, teamId as string | number));
    if (!actual) throw new ForbiddenException("You don't belong to this team.");

    const { roleAtLeast } = await import("./models.js");
    if (!roleAtLeast(actual, role)) {
      throw new ForbiddenException(`This needs the ${role} role.`);
    }

    await next();
  };
}

/* --------------------------------- internals ------------------------------ */

/**
 * The team this user is acting as — verified, not trusted.
 *
 * Reads `current_team_id`, then confirms a membership actually exists. If it doesn't
 * (they were removed, or the id was tampered with), it falls back to a team they are
 * genuinely in rather than honouring the number on the row.
 */
async function resolveTeam(userId: string | number): Promise<string | number | null> {
  const settings = resolveConfig();

  // These lookups are *about* teams, so they must not themselves be tenant-scoped.
  return withoutTenant(async () => {
    const user = await db(settings.userTable).where("id", userId).first();
    const current = user?.current_team_id as string | number | undefined | null;

    if (current != null) {
      const membership = await db(Membership.table)
        .where("user_id", userId)
        .where("team_id", current)
        .first();

      if (membership) return current;
      // Stale or forged: fall through and pick a team they're really in.
    }

    const teams = await teamsFor(userId);
    if (!teams.length) return null;

    const first = teams[0]!.id;
    await db(settings.userTable).where("id", userId).update({ current_team_id: first });
    return first;
  }) as Promise<string | number | null>;
}
