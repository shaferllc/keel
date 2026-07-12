/**
 * `keel watch:prune` — drop entries past the retention window. Contributed as a
 * package command; schedule it (or run it from cron) to keep the table small.
 * Note it only reaches persisted storage: with the in-memory store the ring
 * buffer bounds itself per process, so there's nothing for a separate CLI
 * process to prune.
 */

import type { PackageCommand } from "../core/package.js";
import { defineCommand, flag } from "../core/console.js";
import type { EntryStore } from "./store.js";
import type { WatchConfig } from "./config.js";

export function pruneCommand(store: EntryStore, config: WatchConfig): PackageCommand {
  return defineCommand({
    name: "watch:prune",
    description: "Delete Watch entries older than the retention window",
    flags: { hours: flag.number({ description: "override the retention window (hours)" }) },

    async run({ flags, ui }) {
      // A typed flag, so `--hours nonsense` is now a usage error rather than a NaN
      // that silently prunes everything.
      const hours = flags.hours ?? config.retentionHours;
      const removed = await store.prune(Date.now() - hours * 3_600_000);
      ui.success(`Pruned ${removed} Watch entr${removed === 1 ? "y" : "ies"} older than ${hours}h.`);
    },
  }) as PackageCommand;
}
