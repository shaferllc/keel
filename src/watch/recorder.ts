/**
 * The recorder turns a watcher's observation into a stored `Entry`. It applies
 * the config gates (enabled, per-type toggle, sampling), stamps the entry with
 * the current request/batch id, makes the content JSON-safe, and persists it —
 * fire-and-forget, so recording never blocks or breaks the thing it's watching.
 */

import { currentRequestId } from "../core/instrumentation.js";
import { newUuid, jsonSafe } from "./entry.js";
import type { Entry, EntryType } from "./entry.js";
import type { EntryStore } from "./store.js";
import type { WatchConfig } from "./config.js";

export interface RecordOptions {
  /** Force the batch id (else the current request id, else a fresh one). */
  batchId?: string;
  /** Group this entry with like ones. */
  familyHash?: string;
}

export class Recorder {
  constructor(
    private store: EntryStore,
    private config: WatchConfig,
  ) {}

  /** Whether a given entry type should be recorded at all. */
  enabledFor(type: EntryType): boolean {
    return this.config.enabled && this.config.watchers[type];
  }

  /** Record one entry. A no-op when the type is disabled or sampled out. */
  record(
    type: EntryType,
    content: Record<string, unknown>,
    tags: string[] = [],
    options: RecordOptions = {},
  ): void {
    if (!this.enabledFor(type)) return;
    if (this.config.sampling < 1 && Math.random() > this.config.sampling) return;

    const entry: Entry = {
      uuid: newUuid(),
      batchId: options.batchId ?? currentRequestId() ?? newUuid(),
      type,
      ...(options.familyHash ? { familyHash: options.familyHash } : {}),
      content: jsonSafe(content) as Record<string, unknown>,
      tags,
      createdAt: Date.now(),
    };

    void Promise.resolve(this.store.record([entry])).catch(() => {
      // Persistence failures must never surface into the watched request.
    });
  }
}
