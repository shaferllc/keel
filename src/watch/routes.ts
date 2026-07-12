/**
 * The dashboard's HTTP surface: a small JSON API the SPA polls, and the SPA
 * shell itself. Every route is behind the gate — the API included, so entries
 * can't be read by anyone the dashboard wouldn't show them to.
 *
 * Registered under the configured prefix by the provider, so paths here are
 * relative to it ("/", "/api/entries", …).
 */

import type { Router, Ctx } from "../core/http/router.js";
import type { EntryStore } from "./store.js";
import type { WatchConfig } from "./config.js";
import type { EntryType } from "./entry.js";
import { passesGate } from "./gate.js";
import { dashboardHtml, type ShellOptions } from "./ui-shell.js";

export function registerWatchRoutes(
  r: Router,
  store: EntryStore,
  config: WatchConfig,
  shell: ShellOptions,
): void {
  /** Wrap a JSON handler in the gate. */
  const guarded =
    (handler: (c: Ctx) => Promise<Response> | Response) =>
    async (c: Ctx): Promise<Response> => {
      if (!(await passesGate(c))) return c.json({ error: "Forbidden" }, 403);
      return handler(c);
    };

  // Per-type counts for the tab badges.
  r.get(
    "/api/counts",
    guarded(async (c) => c.json({ counts: await store.counts() })),
  ).name("counts");

  // A page of entries, filtered by type/tag and keyset-paginated by `before`.
  r.get(
    "/api/entries",
    guarded(async (c) => {
      const type = c.req.query("type") as EntryType | undefined;
      const tag = c.req.query("tag") || undefined;
      const before = c.req.query("before") ? Number(c.req.query("before")) : undefined;
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : config.limit;
      const entries = await store.list({
        ...(type ? { type } : {}),
        ...(tag ? { tag } : {}),
        ...(before ? { before } : {}),
        limit,
      });
      return c.json({ entries });
    }),
  ).name("entries");

  // One entry, plus the other entries in its batch (the request it belonged to).
  r.get(
    "/api/entries/:uuid",
    guarded(async (c) => {
      const entry = await store.get(c.req.param("uuid")!);
      if (!entry) return c.json({ error: "Not found" }, 404);
      const related = (await store.batch(entry.batchId)).filter((e) => e.uuid !== entry.uuid);
      return c.json({ entry, related });
    }),
  ).name("entry");

  // Every entry in a batch — a request and all it produced.
  r.get(
    "/api/batch/:batchId",
    guarded(async (c) => c.json({ entries: await store.batch(c.req.param("batchId")!) })),
  ).name("batch");

  // Wipe the store from the dashboard's "Clear" button.
  r.delete(
    "/api/entries",
    guarded(async (c) => {
      await store.clear();
      return c.json({ ok: true });
    }),
  ).name("clear");

  // The SPA shell. Deep links are hash-based, so this one route serves them all.
  r.get(
    "/",
    async (c) => {
      if (!(await passesGate(c))) return c.text("Forbidden", 403);
      return c.html(dashboardHtml(shell));
    },
  ).name("dashboard");
}
