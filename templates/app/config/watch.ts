import { env } from "@shaferllc/keel/core";

/** Keel Watch — local debug dashboard at /watch. */
export default {
  enabled: env("WATCH_ENABLED", true),
  path: "watch",
  storage: "memory",
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
