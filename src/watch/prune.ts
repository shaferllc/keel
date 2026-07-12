/**
 * `keel watch:prune` — drop entries past the retention window. Contributed as a
 * package command; schedule it (or run it from cron) to keep the table small.
 * Note it only reaches persisted storage: with the in-memory store the ring
 * buffer bounds itself per process, so there's nothing for a separate CLI
 * process to prune.
 */

import type { PackageCommand } from "../core/package.js";
import type { EntryStore } from "./store.js";
import type { WatchConfig } from "./config.js";

export function pruneCommand(store: EntryStore, config: WatchConfig): PackageCommand {
  return {
    name: "watch:prune",
    description: "Delete Watch entries older than the retention window",
    configure: (cmd) => cmd.option("--hours <hours>", "override the retention window (hours)"),
    action: async (opts) => {
      const hours = opts.hours ? Number(opts.hours) : config.retentionHours;
      const before = Date.now() - hours * 3_600_000;
      const removed = await store.prune(before);
      console.log(`Pruned ${removed} Watch entr${removed === 1 ? "y" : "ies"} older than ${hours}h.`);
    },
  };
}
