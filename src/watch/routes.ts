/**
 * The dashboard's HTTP surface: a small JSON API the SPA polls, and the SPA
 * shell itself. Every route is behind the gate — the API included, so entries
 * can't be read by anyone the dashboard wouldn't show them to.
 *
 * Registered under the configured prefix by the provider, so paths here are
 * relative to it ("/", "/api/entries", …).
 */

import type { Router, Ctx } from "../core/http/router.js";
import { getQueue, Job, type FailedJob, type FailedJobStore, type QueueDriver } from "../core/queue.js";
import type { EntryStore } from "./store.js";
import type { WatchConfig } from "./config.js";
import type { EntryType } from "./entry.js";
import { passesGate } from "./gate.js";
import { dashboardHtml, type ShellOptions } from "./ui-shell.js";

/** A failed job as the dashboard renders it, whatever driver it came from. */
interface FailedRow {
  id: string;
  job: string;
  queue: string;
  attempts: number;
  error: string;
  failedAt: number | null;
}

/** Uniform list/retry/flush over whichever failure bookkeeping the driver has. */
interface FailedOps {
  list(): Promise<FailedRow[]>;
  retry(id: string): Promise<boolean>;
  flush(id?: string): Promise<number>;
}

/**
 * Adapt the queue driver's failed jobs for the dashboard. A `FailedJobStore`
 * (the database driver) is used as-is; a driver with an in-memory `failed`
 * array (memory/sync) is adapted — retrying re-pushes the live instance.
 * Returns null when the driver tracks nothing.
 */
function failedOps(driver: QueueDriver): FailedOps | null {
  const store = driver as Partial<FailedJobStore>;
  if (
    typeof store.failedJobs === "function" &&
    typeof store.retryFailed === "function" &&
    typeof store.flushFailed === "function"
  ) {
    return {
      list: async () =>
        (await store.failedJobs!()).map((f) => ({
          id: String(f.id),
          job: f.job,
          queue: f.queue,
          attempts: f.attempts,
          error: f.error,
          failedAt: f.failedAt,
        })),
      retry: (id) => store.retryFailed!(id),
      flush: (id) => store.flushFailed!(id),
    };
  }

  const local = driver as QueueDriver & { failed?: FailedJob[] };
  if (!Array.isArray(local.failed)) return null;
  return {
    list: async () =>
      local.failed!.map((f) => ({
        id: f.id,
        job: f.job instanceof Job ? f.job.constructor.name : "fn",
        queue: f.options.queue ?? "default",
        attempts: f.attempts,
        error: f.error instanceof Error ? (f.error.stack ?? f.error.message) : String(f.error),
        failedAt: null,
      })),
    retry: async (id) => {
      const index = local.failed!.findIndex((f) => f.id === id);
      if (index === -1) return false;
      const [f] = local.failed!.splice(index, 1);
      await local.push(f!.job, f!.options);
      return true;
    },
    flush: async (id) => {
      if (id === undefined) return local.failed!.splice(0).length;
      const index = local.failed!.findIndex((f) => f.id === id);
      if (index === -1) return 0;
      local.failed!.splice(index, 1);
      return 1;
    },
  };
}

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

  // The queue's failed jobs — the operational side of the Jobs tab. `failed`
  // is null when the driver keeps no failure list, so the UI can say why.
  r.get(
    "/api/queue/failed",
    guarded(async (c) => {
      const ops = failedOps(getQueue().driver);
      return c.json({ failed: ops ? await ops.list() : null });
    }),
  ).name("queue.failed");

  // Put a failed job back on the queue — one by id, or "all".
  r.post(
    "/api/queue/failed/:id/retry",
    guarded(async (c) => {
      const ops = failedOps(getQueue().driver);
      if (!ops) return c.json({ error: "The queue driver keeps no failed jobs" }, 400);
      const id = c.req.param("id")!;
      if (id === "all") {
        let retried = 0;
        for (const row of await ops.list()) if (await ops.retry(row.id)) retried++;
        return c.json({ retried });
      }
      if (!(await ops.retry(id))) return c.json({ error: "Not found" }, 404);
      return c.json({ retried: 1 });
    }),
  ).name("queue.retry");

  // Delete failed jobs — one by id, or every one.
  r.delete(
    "/api/queue/failed/:id",
    guarded(async (c) => {
      const ops = failedOps(getQueue().driver);
      if (!ops) return c.json({ error: "The queue driver keeps no failed jobs" }, 400);
      const id = c.req.param("id")!;
      const removed = await ops.flush(id === "all" ? undefined : id);
      return c.json({ removed });
    }),
  ).name("queue.flush");

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
