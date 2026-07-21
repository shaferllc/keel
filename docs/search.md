# Search

Full-text search over a pluggable **driver** — the same seam as the cache, queue,
and storage layers, so the core imports no engine and runs on Node and the edge.
`MemoryDriver` is the default; `DatabaseDriver` puts documents in a table and
searches them with whatever full-text machinery your dialect actually has.

## Using it

Declare which fields are searchable, register the model once, and search:

```ts
import { Model, search, registerSearchable } from "@shaferllc/keel/core";

export class Post extends Model {
  static table = "posts";
  static searchable = ["title", "body"];
}

// in a service provider's boot()
registerSearchable(Post);

const posts = await search(Post, "edge runtime").get();   // Post[]
```

`registerSearchable` wires the model's `saved` and `deleted` events to the index,
so writes stay in sync without you remembering to reindex.

## What comes back

`search()` returns a builder, not a promise — chain, then resolve:

```ts
await search(Post, "edge").get();            // Post[], best match first
await search(Post, "edge").first();          // Post | null
await search(Post, "edge").ids();            // string[], nothing loaded
await search(Post, "edge").limit(10).offset(20).get();
```

`get()` resolves ids back into models **through the model's own query builder**,
so casts, global scopes, relations, and soft deletes all still apply — a search
result is an ordinary model, not a second-class one. The rows are then re-sorted
into the driver's order, because `WHERE id IN (…)` has no obligation to preserve
it.

A hit whose row has since been deleted is skipped rather than returned as a hole,
so an index that has drifted degrades quietly instead of handing you `undefined`.

## How queries are interpreted

Every driver agrees on three things, so swapping one doesn't change your results:

- **Terms are AND-ed.** `"edge runtime"` matches documents containing both.
- **Terms match on prefix.** `"config"` finds "configuration".
- **An empty or punctuation-only query matches nothing**, rather than everything.

Punctuation separates terms rather than being searched for, and the user's input
is never treated as query syntax — see [Untrusted input](#untrusted-input).

## Choosing a driver

```ts
import { setSearchDriver, DatabaseSearchDriver } from "@shaferllc/keel/core";

setSearchDriver(new DatabaseSearchDriver());
```

| Driver | Where documents live | Ranking |
| --- | --- | --- |
| `MemorySearchDriver` | in the process | term frequency |
| `DatabaseSearchDriver` | a `search_index` table | the dialect's own |

### The memory driver

The default. Ideal for tests — no database, no migration, and its scoring is
simple enough (how many query terms a document contains, then how often) to
assert ordering against. Not shared across processes, so it is not a production
driver.

### The database driver

Add the migration once:

```ts
import { searchMigration } from "@shaferllc/keel/core";

export const migrations = [searchMigration()];
```

One `search_index` table serves every model — the `idx` column names which — so
making another model searchable needs no migration of its own.

The DDL is dialect-specific, because full-text support is:

| Dialect | Index | Query |
| --- | --- | --- |
| `sqlite` | FTS5 virtual table | `MATCH`, ranked by `rank` |
| `postgres` | generated `tsvector` + GIN | `@@ to_tsquery`, ranked by `ts_rank` |
| `mysql` | `FULLTEXT` index | `LIKE` fallback |
| anything else | plain table | `LIKE` fallback |

The `LIKE` fallback returns the right rows but doesn't rank them, and scans. It's
there so a dialect without full-text still *works*, not so you'd choose it.

## Keeping the index current

`registerSearchable` handles ongoing writes. For a table that existed before it
was searchable — or after a bulk import that bypassed the model — backfill from
the console:

```bash
npm run keel search:index Post          # rebuild from the table
npm run keel search:index Post -- --chunk 1000
npm run keel search:flush Post          # empty the index
```

`search:index` flushes the index first, so it is a rebuild rather than a top-up
and removed rows don't linger. That does mean an interrupted run leaves a partial
index — re-run it.

In code, the same thing is `reindex(Post)`, which returns how many documents it
wrote and pages through the table in chunks so a large table doesn't arrive all
at once.

## Untrusted input

A search box is user input going into a query language, which is the shape of an
injection bug. Keel's drivers don't interpolate it:

- The **SQLite** driver quotes each term for FTS5, so `OR`, `NEAR`, `*`, and a
  stray `"` are words to search for, not operators that change what the query
  means.
- The **Postgres** driver builds its `tsquery` from parsed terms rather than
  handing the raw string to `to_tsquery`, which would raise on malformed input.
- Every driver parameterizes its SQL.

So you can pass a raw search box straight through. It won't throw a syntax error
and it can't widen the query.

## Testing

The default driver is already in-memory, so tests need no setup. To start from a
known state, set a fresh one:

```ts
import { setSearchDriver, MemorySearchDriver, reindex } from "@shaferllc/keel/core";

setSearchDriver(new MemorySearchDriver());
await reindex(Post);

assert.equal((await search(Post, "edge").first())?.title, "Edge runtime basics");
```

Model hooks persist between tests, so if you register searchable models in a test
suite, `clearModelHooks()` between cases.

## Writing a driver

A driver is four methods. It stores and ranks documents and never loads your
models — whatever it returns, `search()` resolves through the query builder.

```ts
import type { SearchDriver } from "@shaferllc/keel/core";

const meiliDriver = (client: MeiliClient): SearchDriver => ({
  async index(index, documents) {
    await client.index(index).addDocuments(
      documents.map((d) => ({ id: d.id, ...d.fields })),
    );
  },
  async delete(index, ids) {
    await client.index(index).deleteDocuments(ids);
  },
  async search(index, query, options = {}) {
    const res = await client.index(index).search(query, {
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
    return res.hits.map((h) => ({ id: String(h.id), score: h._rankingScore }));
  },
  async flush(index) {
    await client.index(index).deleteAllDocuments();
  },
});
```

Return hits **best first**, and use a bigger `score` for a better hit — that's the
convention `MemoryDriver` and `DatabaseDriver` both follow (SQLite's `rank` is
negated for exactly this reason, since FTS5 counts *down*).

## Related

Search sits on top of [models](./models.md) and their
[events](./hooks.md). The [console](./console.md) has `search:index` and
`search:flush`.

---

## API reference

### `search(model, query)`

`search<T extends Model>(model: ModelClass<T>, query: string): SearchQuery<T>`

Start a search against a model. Returns a builder; nothing runs until you call
`get()`, `first()`, or `ids()`.

### `SearchQuery`

#### `limit(n)` / `offset(n)`

`limit(n: number): this` · `offset(n: number): this`

Cap and page the hits. Default limit is 50.

#### `get()`

`get(): Promise<T[]>`

The matching models, best first. Resolves ids through the model's query builder,
then restores the driver's order. Hits whose rows no longer exist are dropped.

#### `first()`

`first(): Promise<T | null>`

The best hit, or null.

#### `ids()`

`ids(): Promise<string[]>`

The matching ids, best first, without loading models.

### `registerSearchable(model)`

`registerSearchable<T extends Model>(model: ModelClass<T>): void`

Wire a model's `saved` and `deleted` events to its index. Call once at boot.

**Notes:** throws if the model has no `static searchable` fields — indexing
nothing is a mistake that otherwise surfaces much later as "search finds
nothing". The index name is `static searchIndex` if set, else the model's table.

### `reindex(model, options?)`

`reindex<T extends Model>(model: ModelClass<T>, options?: { chunk?: number }): Promise<number>`

Flush the index and rebuild it from the table. Returns the document count.

**Notes:** `chunk` defaults to 500 rows per read.

### `setSearchDriver(driver)` / `searchDriver()`

`setSearchDriver(driver: SearchDriver): void` · `searchDriver(): SearchDriver`

Register the driver, and read it back. Defaults to `MemorySearchDriver`.

### `searchMigration(table?)`

`searchMigration(table?: string): Migration`

The `search_index` table `DatabaseSearchDriver` reads. Table name defaults to
`"search_index"`; the DDL varies by dialect.

### `documentText(fields)`

`documentText(fields: Record<string, unknown>): string`

Flatten a document's scalar fields into the text blob a text index stores.
Objects and nullish values are skipped.

### Interfaces & types

#### `SearchDriver`

`{ index, delete, search, flush }` — the driver seam.

#### `SearchDocument`

`{ id: string, fields: Record<string, unknown> }`.

#### `SearchOptions`

`{ limit?, offset? }` — limit defaults to 50, offset to 0.

#### `SearchHit`

`{ id: string, score?: number }` — bigger score, better hit.
