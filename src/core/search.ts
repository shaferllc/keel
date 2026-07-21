/**
 * Full-text search over a pluggable **driver** — the same shape as the cache,
 * queue, and storage layers, so the core imports no engine and runs on Node and
 * the edge.
 *
 * Models opt in by declaring which fields are searchable and registering once:
 *
 *   class Post extends Model {
 *     static table = "posts";
 *     static searchable = ["title", "body"];
 *   }
 *
 *   registerSearchable(Post);                    // in a service provider
 *   const hits = await search(Post, "edge runtime").get();
 *
 * Registering wires the model's `saved` and `deleted` events to the index, so
 * writes stay in sync without you remembering to reindex. Backfill an existing
 * table with `keel search:index Post`.
 *
 * `MemoryDriver` is the default, which keeps tests honest without a database.
 * `DatabaseDriver` puts documents in a `search_index` table and searches them
 * with whatever full-text machinery the dialect actually has — SQLite's FTS5,
 * Postgres' `tsvector`, MySQL's `FULLTEXT` — falling back to `LIKE` only where
 * there is nothing better.
 */

import { getConnection, type Connection, type Dialect, type Row } from "./database.js";
import { Model } from "./model.js";
import { addModelHook } from "./model-events.js";
import type { Migration } from "./migrations.js";

/* --------------------------------- types ---------------------------------- */

/** One indexed record: which index it belongs to, its id, and its fields. */
export interface SearchDocument {
  id: string;
  fields: Record<string, unknown>;
}

export interface SearchOptions {
  /** Maximum hits to return. Default: 50. */
  limit?: number;
  /** Hits to skip, for paging. Default: 0. */
  offset?: number;
}

/** A hit: the document's id, and the driver's relevance score when it has one. */
export interface SearchHit {
  id: string;
  score?: number;
}

/**
 * The bridge to a search backend. Four methods, deliberately id-shaped: a driver
 * stores and ranks documents, and never loads your models. Whatever it returns,
 * `search()` turns back into models through the ordinary query builder — so
 * relations, casts, and global scopes all still apply to a search result.
 */
export interface SearchDriver {
  /** Add or replace documents in an index. */
  index(index: string, documents: SearchDocument[]): Promise<void>;
  /** Remove documents by id. */
  delete(index: string, ids: string[]): Promise<void>;
  /** Ids matching `query`, best first. */
  search(index: string, query: string, options?: SearchOptions): Promise<SearchHit[]>;
  /** Drop everything in an index. */
  flush(index: string): Promise<void>;
}

/** Flatten a document's fields into the one text blob a text index stores. */
export function documentText(fields: Record<string, unknown>): string {
  return Object.values(fields)
    .filter((v) => v != null && typeof v !== "object")
    .map(String)
    .join(" ");
}

/** Split a query into terms. Punctuation is separator, not content. */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

/* ------------------------------ memory driver ------------------------------ */

/**
 * An in-memory index — the default, and what tests should use. Scoring is
 * deliberately simple (how many query terms a document contains, then how
 * often), which is enough to assert ordering without pretending to be BM25.
 */
export class MemoryDriver implements SearchDriver {
  private indexes = new Map<string, Map<string, string>>();

  private bucket(index: string): Map<string, string> {
    let bucket = this.indexes.get(index);
    if (!bucket) this.indexes.set(index, (bucket = new Map()));
    return bucket;
  }

  async index(index: string, documents: SearchDocument[]): Promise<void> {
    const bucket = this.bucket(index);
    for (const doc of documents) bucket.set(doc.id, documentText(doc.fields).toLowerCase());
  }

  async delete(index: string, ids: string[]): Promise<void> {
    const bucket = this.bucket(index);
    for (const id of ids) bucket.delete(id);
  }

  async search(index: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const wanted = terms(query);
    if (!wanted.length) return [];

    const hits: SearchHit[] = [];
    for (const [id, text] of this.bucket(index)) {
      const words = terms(text);
      // Every term must appear — an AND search, like the real drivers do.
      if (!wanted.every((t) => words.some((w) => w.startsWith(t)))) continue;
      const score = wanted.reduce(
        (total, t) => total + words.filter((w) => w.startsWith(t)).length,
        0,
      );
      hits.push({ id, score });
    }

    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
    const offset = options.offset ?? 0;
    return hits.slice(offset, offset + (options.limit ?? 50));
  }

  async flush(index: string): Promise<void> {
    this.indexes.delete(index);
  }
}

/* ----------------------------- database driver ----------------------------- */

/** The table `searchMigration()` creates and `DatabaseDriver` reads. */
const TABLE = "search_index";

/**
 * Documents in a database table, searched with the dialect's own full-text
 * support. One table serves every index — `idx` names which — so adding a
 * searchable model needs no migration of its own.
 */
export class DatabaseDriver implements SearchDriver {
  constructor(private table = TABLE) {}

  private conn(): { connection: Connection; dialect: Dialect } {
    const { connection, dialect } = getConnection();
    return { connection, dialect };
  }

  /** `?` → `$n` for Postgres, as everywhere else in Keel. */
  private ph(sql: string, dialect: Dialect): string {
    if (dialect !== "postgres") return sql;
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async index(index: string, documents: SearchDocument[]): Promise<void> {
    const { connection, dialect } = this.conn();
    // Replace rather than upsert: FTS5 virtual tables have no unique constraint
    // to conflict on, so there is no portable ON CONFLICT here.
    await this.delete(index, documents.map((d) => d.id));

    for (const doc of documents) {
      await connection.write(
        this.ph(`INSERT INTO ${this.table} (idx, doc_id, content) VALUES (?, ?, ?)`, dialect),
        [index, doc.id, documentText(doc.fields)],
      );
    }
  }

  async delete(index: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { connection, dialect } = this.conn();
    const holes = ids.map(() => "?").join(", ");
    await connection.write(
      this.ph(`DELETE FROM ${this.table} WHERE idx = ? AND doc_id IN (${holes})`, dialect),
      [index, ...ids],
    );
  }

  async search(index: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const { connection, dialect } = this.conn();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const words = terms(query);
    if (!words.length) return [];

    if (dialect === "sqlite") {
      // FTS5 takes its own query syntax, so the user's words are quoted one by
      // one — that way a stray `"` or `OR` is a word to search for, not syntax
      // that changes what the query means.
      const match = words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" AND ");
      const rows = (await connection.select(
        `SELECT doc_id, rank AS score FROM ${this.table} ` +
          `WHERE idx = ? AND ${this.table} MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
        [index, match, limit, offset],
      )) as Row[];
      // FTS5 `rank` is better the *more negative* it is; flip it so every driver
      // agrees that a bigger score means a better hit.
      return rows.map((r) => ({ id: String(r.doc_id), score: -Number(r.score) }));
    }

    if (dialect === "postgres") {
      const match = words.map((w) => `${w}:*`).join(" & ");
      const rows = (await connection.select(
        `SELECT doc_id, ts_rank(tsv, to_tsquery('english', $2)) AS score FROM ${this.table} ` +
          `WHERE idx = $1 AND tsv @@ to_tsquery('english', $2) ` +
          `ORDER BY score DESC LIMIT $3 OFFSET $4`,
        [index, match, limit, offset],
      )) as Row[];
      return rows.map((r) => ({ id: String(r.doc_id), score: Number(r.score) }));
    }

    // MySQL and anything else: AND-ed LIKEs. Not ranked and not fast, but it
    // returns the right rows, and it is honest about being the fallback.
    const wheres = words.map(() => "LOWER(content) LIKE ?").join(" AND ");
    const rows = (await connection.select(
      `SELECT doc_id FROM ${this.table} WHERE idx = ? AND ${wheres} ` +
        `ORDER BY doc_id LIMIT ? OFFSET ?`,
      [index, ...words.map((w) => `%${w}%`), limit, offset],
    )) as Row[];
    return rows.map((r) => ({ id: String(r.doc_id) }));
  }

  async flush(index: string): Promise<void> {
    const { connection, dialect } = this.conn();
    await connection.write(this.ph(`DELETE FROM ${this.table} WHERE idx = ?`, dialect), [index]);
  }
}

/**
 * The `search_index` table `DatabaseDriver` needs. The DDL is dialect-specific
 * because full-text support is: SQLite gets an FTS5 virtual table, Postgres a
 * generated `tsvector` with a GIN index, MySQL a `FULLTEXT` index, and anything
 * else a plain table the `LIKE` fallback can still scan.
 */
export function searchMigration(table = TABLE): Migration {
  return {
    name: `search_00_${table}`,
    async up(schema) {
      const { dialect } = getConnection();

      if (dialect === "sqlite") {
        await schema.raw(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} ` +
            `USING fts5(idx UNINDEXED, doc_id UNINDEXED, content)`,
        );
        return;
      }

      if (dialect === "postgres") {
        await schema.raw(
          `CREATE TABLE IF NOT EXISTS ${table} (` +
            `idx VARCHAR(255) NOT NULL, doc_id VARCHAR(255) NOT NULL, content TEXT NOT NULL, ` +
            `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED, ` +
            `PRIMARY KEY (idx, doc_id))`,
        );
        await schema.raw(`CREATE INDEX IF NOT EXISTS ${table}_tsv ON ${table} USING GIN (tsv)`);
        return;
      }

      await schema.createTable(table, (t) => {
        t.string("idx");
        t.string("doc_id");
        t.text("content");
        t.index(["idx", "doc_id"]);
      });
      if (dialect === "mysql") {
        await schema.raw(`ALTER TABLE ${table} ADD FULLTEXT INDEX ${table}_content (content)`);
      }
    },
    async down(schema) {
      await schema.dropTable(table);
    },
  };
}

/* -------------------------------- registry -------------------------------- */

let driver: SearchDriver = new MemoryDriver();

/** Register the driver searches go through. Call once at boot. */
export function setSearchDriver(next: SearchDriver): void {
  driver = next;
}

/** The registered driver — `MemoryDriver` until you set one. */
export function searchDriver(): SearchDriver {
  return driver;
}

/* --------------------------- model integration ---------------------------- */

type ModelClass<T extends Model> = (new (attributes?: Row) => T) & typeof Model & {
  searchable?: string[];
  searchIndex?: string;
};

/** The index a model's documents live in — `searchIndex`, else its table. */
export function indexFor(model: { searchIndex?: string; table: string }): string {
  return model.searchIndex ?? model.table;
}

/** The fields a model contributes to its document. */
function fieldsFor<T extends Model>(model: ModelClass<T>, instance: T): Record<string, unknown> {
  const names = model.searchable ?? [];
  const record = instance as unknown as Record<string, unknown>;
  return Object.fromEntries(names.map((name) => [name, record[name]]));
}

/** A model's primary key as the string the index stores. */
function keyOf<T extends Model>(model: ModelClass<T>, instance: T): string {
  return String((instance as unknown as Record<string, unknown>)[model.primaryKey]);
}

/**
 * Keep a model's documents in step with its rows: indexed on save, removed on
 * delete. Call once per searchable model at boot, the same way `registerJobs()`
 * introduces job classes to the queue.
 *
 * A model with no `searchable` fields is refused rather than silently indexing
 * nothing — that mistake otherwise shows up as "search returns no results" long
 * after the fact.
 */
export function registerSearchable<T extends Model>(model: ModelClass<T>): void {
  if (!model.searchable?.length) {
    throw new Error(
      `${model.name} has no static searchable fields. Add e.g. ` +
        `\`static searchable = ["title", "body"]\` before registering it.`,
    );
  }

  const index = indexFor(model as unknown as { searchIndex?: string; table: string });

  addModelHook(model, "saved", async (instance) => {
    await driver.index(index, [
      { id: keyOf(model, instance as T), fields: fieldsFor(model, instance as T) },
    ]);
  });

  addModelHook(model, "deleted", async (instance) => {
    await driver.delete(index, [keyOf(model, instance as T)]);
  });
}

/** A search against a model, resolved to models through the query builder. */
export class SearchQuery<T extends Model> {
  private options: SearchOptions = {};

  constructor(private model: ModelClass<T>, private query: string) {}

  limit(n: number): this {
    this.options.limit = n;
    return this;
  }
  offset(n: number): this {
    this.options.offset = n;
    return this;
  }

  /** The matching ids, best first, without loading anything. */
  async ids(): Promise<string[]> {
    const index = indexFor(this.model as unknown as { searchIndex?: string; table: string });
    const hits = await driver.search(index, this.query, this.options);
    return hits.map((h) => h.id);
  }

  /**
   * The matching models, still in relevance order. The rows come back through
   * the model's own query — so casts, global scopes, and soft deletes all apply
   * — and are then re-sorted to the order the driver returned, because `WHERE
   * id IN (…)` has no obligation to preserve it.
   */
  async get(): Promise<T[]> {
    const ids = await this.ids();
    if (!ids.length) return [];

    const rows = (await this.model
      .query()
      .whereIn(this.model.primaryKey, ids)
      .get()) as Row[];

    const byId = new Map(rows.map((row) => [String(row[this.model.primaryKey]), row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is Row => row !== undefined)
      .map((row) => new this.model(row));
  }

  /** The first match, or null. */
  async first(): Promise<T | null> {
    const [found] = await this.limit(1).get();
    return found ?? null;
  }
}

/** Search a model. `await search(Post, "edge runtime").get()`. */
export function search<T extends Model>(model: ModelClass<T>, query: string): SearchQuery<T> {
  return new SearchQuery(model, query);
}

/**
 * Index every row of a model — the backfill for a table that existed before it
 * was searchable, and what `keel search:index` runs. Returns how many documents
 * were written.
 */
export async function reindex<T extends Model>(
  model: ModelClass<T>,
  options: { chunk?: number } = {},
): Promise<number> {
  const index = indexFor(model as unknown as { searchIndex?: string; table: string });
  const chunk = options.chunk ?? 500;

  await driver.flush(index);

  let offset = 0;
  let total = 0;
  for (;;) {
    const rows = (await model.query().limit(chunk).offset(offset).get()) as Row[];
    if (!rows.length) return total;

    const documents = rows.map((row) => {
      const instance = new model(row);
      return { id: keyOf(model, instance), fields: fieldsFor(model, instance) };
    });
    await driver.index(index, documents);

    total += documents.length;
    offset += chunk;
  }
}
