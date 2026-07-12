/**
 * Watch configuration. Defaults live here and are merged under `config("watch")`
 * by the provider; an app overrides any of them in `config/watch.ts` (publish it
 * with `keel vendor:publish --tag watch-config`).
 */

import { config } from "../core/helpers.js";
import type { EntryType } from "./entry.js";

export interface WatchConfig {
  /** Master switch. Off → no watchers install and the dashboard 404s. */
  enabled: boolean;
  /** URL prefix the dashboard and API mount under. Default: "watch". */
  path: string;
  /** Where entries live. "database" persists them; "memory" is a per-process ring. */
  storage: "database" | "memory";
  /** The database connection to use (when storage is "database"). */
  connection?: string;
  /** The table entries are stored in. */
  table: string;
  /** Ring size for the memory store, and the default page size for the API. */
  limit: number;
  /** Record only this fraction of eligible entries (0–1). 1 records everything. */
  sampling: number;
  /** Tag queries slower than this (ms) with `slow`. */
  slowQueryMs: number;
  /** Request path prefixes to never record (the dashboard's own are always skipped). */
  ignorePaths: string[];
  /** Delete entries older than this many hours when `watch:prune` runs. */
  retentionHours: number;
  /** Per-type on/off switches. Noisy watchers (cache, event) default off. */
  watchers: Record<EntryType, boolean>;
}

export const defaultConfig: WatchConfig = {
  enabled: true,
  path: "watch",
  storage: "database",
  table: "watch_entries",
  limit: 100,
  sampling: 1,
  slowQueryMs: 100,
  ignorePaths: [],
  retentionHours: 24,
  watchers: {
    request: true,
    query: true,
    exception: true,
    log: true,
    mail: true,
    job: true,
    notification: true,
    cache: false,
    event: false,
    schedule: true,
  },
};

/** Read the effective Watch config off the application, filling any gaps. */
export function resolveConfig(): WatchConfig {
  const raw = config<Partial<WatchConfig>>("watch", {});
  return {
    ...defaultConfig,
    ...raw,
    watchers: { ...defaultConfig.watchers, ...(raw.watchers ?? {}) },
  };
}
