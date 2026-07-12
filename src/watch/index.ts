/**
 * Keel Watch — a debug dashboard for Keel apps, imported from
 * `@shaferllc/keel/watch`. Register the provider and open `/watch`:
 *
 *   import { WatchServiceProvider } from "@shaferllc/keel/watch";
 *   app.register(WatchServiceProvider);
 *
 * Lock down who can see it with `Watch.auth()`.
 */

export { WatchServiceProvider } from "./provider.js";
export { Watch } from "./gate.js";
export type { WatchGate } from "./gate.js";
export { resolveConfig, defaultConfig } from "./config.js";
export type { WatchConfig } from "./config.js";
export { MemoryStore, DatabaseStore } from "./store.js";
export type { EntryStore } from "./store.js";
export { watchMigration } from "./migration.js";
export { Recorder } from "./recorder.js";
export { installWatchers } from "./watchers.js";
export {
  ENTRY_TYPES,
  newUuid,
  familyHash,
  jsonSafe,
  redactHeaders,
  sqlShape,
} from "./entry.js";
export type { Entry, EntryType, EntryFilter } from "./entry.js";
