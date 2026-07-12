/**
 * Where recorded entries live. Two implementations behind one interface:
 *
 *   - `MemoryStore` — a per-process ring buffer. Zero setup, great for a single
 *     dev process or the edge; entries vanish on restart.
 *   - `DatabaseStore` — a `watch_entries` table via any registered connection.
 *     Survives restarts and is shared across processes; needs `keel migrate`.
 *
 * The store's own reads and writes hit the database like anything else, so they
 * would show up in the Query watcher — an infinite hall of mirrors. The watcher
 * filters them out by table name (see `watchers.ts`); the store just does its job.
 */

import { connection } from "../core/database.js";
import type { Entry, EntryFilter, EntryType } from "./entry.js";
import { ENTRY_TYPES } from "./entry.js";

export interface EntryStore {
  /** Persist a batch of entries. */
  record(entries: Entry[]): Promise<void>;
  /** One entry by id. */
  get(uuid: string): Promise<Entry | undefined>;
  /** Entries matching a filter, newest first. */
  list(filter: EntryFilter): Promise<Entry[]>;
  /** Every entry in one batch (a request and its children), newest first. */
  batch(batchId: string): Promise<Entry[]>;
  /** How many entries of each type — for the dashboard's tab counts. */
  counts(): Promise<Record<EntryType, number>>;
  /** Delete entries created before `timestamp`. Returns how many. */
  prune(timestamp: number): Promise<number>;
  /** Delete everything. */
  clear(): Promise<void>;
}

/* -------------------------------- memory ---------------------------------- */

export class MemoryStore implements EntryStore {
  private entries: Entry[] = [];

  constructor(private cap = 1000) {}

  async record(entries: Entry[]): Promise<void> {
    // newest first; trim the oldest past the cap
    this.entries.unshift(...entries);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
  }

  async get(uuid: string): Promise<Entry | undefined> {
    return this.entries.find((e) => e.uuid === uuid);
  }

  async list(filter: EntryFilter): Promise<Entry[]> {
    let rows = this.entries;
    if (filter.type) rows = rows.filter((e) => e.type === filter.type);
    if (filter.tag) rows = rows.filter((e) => e.tags.includes(filter.tag!));
    if (filter.batchId) rows = rows.filter((e) => e.batchId === filter.batchId);
    if (filter.before != null) rows = rows.filter((e) => e.createdAt < filter.before!);
    return rows.slice(0, filter.limit ?? 100);
  }

  async batch(batchId: string): Promise<Entry[]> {
    return this.entries.filter((e) => e.batchId === batchId);
  }

  async counts(): Promise<Record<EntryType, number>> {
    const counts = emptyCounts();
    for (const e of this.entries) counts[e.type]++;
    return counts;
  }

  async prune(timestamp: number): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.createdAt >= timestamp);
    return before - this.entries.length;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}

/* ------------------------------- database --------------------------------- */

/** A stored row, before/after JSON (de)serialization of content and tags. */
interface StoredRow {
  uuid: string;
  batch_id: string;
  type: string;
  family_hash: string | null;
  content: string;
  tags: string;
  created_at: number;
}

export class DatabaseStore implements EntryStore {
  constructor(
    private table: string,
    private connectionName?: string,
  ) {}

  private conn() {
    return connection(this.connectionName);
  }

  async record(entries: Entry[]): Promise<void> {
    const conn = this.conn();
    for (const e of entries) {
      await conn.write(
        `INSERT INTO ${this.table} (uuid, batch_id, type, family_hash, content, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          e.uuid,
          e.batchId,
          e.type,
          e.familyHash ?? null,
          JSON.stringify(e.content),
          // tags stored comma-wrapped (",a,b,") so `LIKE '%,tag,%'` matches exactly
          e.tags.length ? `,${e.tags.join(",")},` : "",
          e.createdAt,
        ],
      );
    }
  }

  async get(uuid: string): Promise<Entry | undefined> {
    const rows = (await this.conn().select(
      `SELECT * FROM ${this.table} WHERE uuid = ? LIMIT 1`,
      [uuid],
    )) as unknown as StoredRow[];
    return rows[0] ? hydrate(rows[0]) : undefined;
  }

  async list(filter: EntryFilter): Promise<Entry[]> {
    const where: string[] = [];
    const bindings: unknown[] = [];
    if (filter.type) {
      where.push("type = ?");
      bindings.push(filter.type);
    }
    if (filter.batchId) {
      where.push("batch_id = ?");
      bindings.push(filter.batchId);
    }
    if (filter.tag) {
      where.push("tags LIKE ?");
      bindings.push(`%,${filter.tag},%`);
    }
    if (filter.before != null) {
      where.push("created_at < ?");
      bindings.push(filter.before);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = (await this.conn().select(
      `SELECT * FROM ${this.table} ${clause} ORDER BY created_at DESC LIMIT ${Number(filter.limit ?? 100)}`,
      bindings,
    )) as unknown as StoredRow[];
    return rows.map(hydrate);
  }

  async batch(batchId: string): Promise<Entry[]> {
    const rows = (await this.conn().select(
      `SELECT * FROM ${this.table} WHERE batch_id = ? ORDER BY created_at ASC`,
      [batchId],
    )) as unknown as StoredRow[];
    return rows.map(hydrate);
  }

  async counts(): Promise<Record<EntryType, number>> {
    const rows = (await this.conn().select(
      `SELECT type, COUNT(*) AS n FROM ${this.table} GROUP BY type`,
      [],
    )) as { type: string; n: number }[];
    const counts = emptyCounts();
    for (const r of rows) {
      if (r.type in counts) counts[r.type as EntryType] = Number(r.n);
    }
    return counts;
  }

  async prune(timestamp: number): Promise<number> {
    const result = await this.conn().write(
      `DELETE FROM ${this.table} WHERE created_at < ?`,
      [timestamp],
    );
    return result.rowsAffected;
  }

  async clear(): Promise<void> {
    await this.conn().write(`DELETE FROM ${this.table}`, []);
  }
}

/* -------------------------------- helpers --------------------------------- */

function emptyCounts(): Record<EntryType, number> {
  return Object.fromEntries(ENTRY_TYPES.map((t) => [t, 0])) as Record<EntryType, number>;
}

/** Turn a stored row back into an Entry. */
function hydrate(row: StoredRow): Entry {
  return {
    uuid: row.uuid,
    batchId: row.batch_id,
    type: row.type as EntryType,
    ...(row.family_hash ? { familyHash: row.family_hash } : {}),
    content: safeParse(row.content),
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    createdAt: Number(row.created_at),
  };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { raw: json };
  }
}
