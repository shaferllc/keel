/**
 * Which team the current work belongs to.
 *
 * Carried in `AsyncLocalStorage`, not a module global, so two concurrent requests
 * can't see each other's team — the same reason Keel carries the request and the
 * open transaction that way.
 *
 * **There is no "no team" fallback.** `currentTeamId()` throws when nothing has set
 * a team, and `TenantModel`'s scope calls it on every query. That is deliberate, and
 * it is the whole security model:
 *
 *   - Return *unscoped* when there's no team, and every background job silently sees
 *     every tenant's rows. This is how customer A's invoice reaches customer B.
 *   - Return `undefined` into the where clause (`teamId = NULL`) and jobs match
 *     nothing, "work" fine, and quietly do nothing for a month.
 *   - Throw, and a job that forgot crashes in development instead of leaking in
 *     production.
 *
 * A job, a console command, a webhook, a seeder — none of them run inside a request,
 * so each one has to say which team it is for:
 *
 *   await runForTeam(team, () => sendInvoices());
 *
 * ...or say, out loud and greppably, that it isn't for one:
 *
 *   await withoutTenant(() => Post.query().get());   // every team's posts
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TeamContext {
  /** `null` means "deliberately no tenant" — set by `withoutTenant`. */
  teamId: string | number | null;
}

const storage = new AsyncLocalStorage<TeamContext>();

/** Run `fn` with this team as the current tenant. */
export function runForTeam<T>(team: string | number | { id: string | number }, fn: () => T): T {
  const teamId = typeof team === "object" ? team.id : team;
  return storage.run({ teamId }, fn);
}

/**
 * Run `fn` with tenant scoping switched **off**.
 *
 * Every use of this is a query that crosses tenant boundaries, so it should be easy
 * to find and easy to justify. That's the point of making it a named call rather
 * than something you get by forgetting a `where`.
 */
export function withoutTenant<T>(fn: () => T): T {
  return storage.run({ teamId: null }, fn);
}

/** The current team's id, or `undefined` outside any team context. */
export function currentTeam(): string | number | null | undefined {
  return storage.getStore()?.teamId;
}

/** Is there a team context at all (including a deliberate `withoutTenant`)? */
export function hasTeamContext(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * The current team's id — or an error.
 *
 * Called by the tenant scope on every query, so this is the thing that turns "I
 * forgot" into a crash rather than a leak.
 */
export function currentTeamId(): string | number {
  const store = storage.getStore();

  if (!store) {
    throw new Error(
      "No team in context, so a tenant-scoped query can't be built safely.\n" +
        "Inside a request, add teamContext() to your middleware.\n" +
        "In a job, command, or seeder, wrap the work: runForTeam(team, () => …).\n" +
        "If it genuinely spans every team, say so: withoutTenant(() => …).",
    );
  }

  if (store.teamId === null) {
    // withoutTenant() — the caller has already said this query crosses tenants, and
    // the scope is skipped before it ever asks for an id.
    throw new Error("currentTeamId() called inside withoutTenant().");
  }

  return store.teamId;
}
