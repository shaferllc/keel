# Migrations

Version your database schema. A migration is a `{ name, up, down }` object; a
fluent **schema builder** describes tables, and the **migrator** runs them
against your [connection](./database.md), tracking what's applied. The SQL is
dialect-aware (sqlite / mysql / postgres) and the core imports no driver.

## Define migrations

```ts
import type { Migration } from "@shaferllc/keel/core";

export const migrations: Migration[] = [
  {
    name: "01_create_users",
    up: (schema) =>
      schema.createTable("users", (t) => {
        t.id();
        t.string("email").unique();
        t.string("name");
        t.boolean("active").default(true);
        t.timestamps();               // created_at + updated_at
      }),
    down: (schema) => schema.dropTable("users"),
  },
];
```

A migration's `name` is its identity — the migrator records it verbatim in the
bookkeeping table and skips it on re-runs. Keep names stable and ordered (an
`NN_` prefix sorts them); the migrator runs the array in the order you give it.
`up`/`down` may be sync or async (`void | Promise<void>`) — return the
`schema.createTable(...)` promise, or `await` several statements.

### Column types

`t.id()` · `t.string(name, length?)` · `t.text(name)` · `t.integer(name)` ·
`t.bigInteger(name)` · `t.boolean(name)` · `t.timestamp(name)` · `t.json(name)` ·
`t.timestamps()`.

Every column method except `timestamps()` returns a [`Column`](#column) you can
chain modifiers on: `.nullable()`, `.unique()`, `.default(value)`. `timestamps()`
returns `void` — it adds nullable `created_at` and `updated_at` for you, so
there's nothing to chain.

```ts
schema.createTable("posts", (t) => {
  t.id();
  t.integer("user_id");
  t.string("slug", 120).unique();
  t.text("body").nullable();
  t.json("meta").nullable();
  t.boolean("published").default(false);
  t.timestamps();
});
```

Columns are emitted in the order you declare them. `t.id()` is special: it maps
to the dialect's auto-increment primary key (`SERIAL PRIMARY KEY`,
`INT AUTO_INCREMENT PRIMARY KEY`, or `INTEGER PRIMARY KEY AUTOINCREMENT`) and is
never marked `NOT NULL` — modifiers on it are redundant.

### Defaults and nullability

By default every column is `NOT NULL`; `.nullable()` drops that. `.default(v)`
renders the literal inline: strings are single-quoted, booleans become `1`/`0`
on sqlite and `true`/`false` elsewhere, numbers pass through. Because the default
is inlined (not a binding), keep it to dev-authored constants.

```ts
t.string("role").default("member");   // ... DEFAULT 'member'
t.boolean("active").default(true);     // sqlite: DEFAULT 1, else DEFAULT true
t.integer("retries").default(0);       // ... DEFAULT 0
```

### Indexes and foreign keys

`createTable` builds indexes and foreign keys alongside the columns:

```ts
schema.createTable("members", (t) => {
  t.id();
  t.integer("team_id");
  t.string("email");
  t.uniqueIndex("email");                       // or t.index(["a", "b"]) for composite
  t.foreign("team_id").references("id").on("teams").onDelete("cascade");
});
```

### Altering a table

`schema.alterTable(name, build)` adds, renames, and drops columns and indexes on
an existing table (dialect-aware SQL). Drop an index before the column it covers:

```ts
up: (schema) =>
  schema.alterTable("users", (t) => {
    t.string("phone").nullable();     // ADD COLUMN
    t.renameColumn("name", "full_name");
    t.index("phone");
    t.dropIndex("users_legacy_index");
    t.dropColumn("legacy");
  }),
```

For anything the builder still doesn't cover, `schema.raw(sql, bindings?)` runs
arbitrary SQL:

```ts
up: (schema) => schema.raw("CREATE INDEX idx_posts_user ON posts (user_id)"),
```

> `raw()` takes `?` placeholders on every dialect and rewrites them to `$1, $2`
> on `postgres`, so the same migration runs unchanged against either database.

## Run and roll back

```ts
import { Migrator } from "@shaferllc/keel/core";

const migrator = new Migrator(connection, "postgres");

await migrator.up(migrations);    // runs pending migrations (idempotent)
await migrator.down(migrations);  // rolls back the last batch
await migrator.reset(migrations); // rolls back every batch
await migrator.ran();             // names already applied
await migrator.dropAllTables();   // drops every table, bookkeeping included
```

`up()` records each applied migration in a `migrations` table
(`name` PRIMARY KEY, `batch`), so re-running only applies new ones. Every
migration applied in a single `up()` call shares one batch number — the previous
max plus one. `down()` reverses just the most recent batch, in reverse
declaration order, calling each migration's `down()`.

Both `up()` and `down()` return the list of names they touched, so you can report
progress:

```ts
const applied = await migrator.up(migrations); // ["02_add_posts"]
const rolled = await migrator.down(migrations); // ["02_add_posts"]
```

The bookkeeping table is created on demand — `up()`, `down()`, and `ran()` each
ensure `migrations` exists before touching it, so a fresh database Just Works.

### Edge cases

- **Nothing pending:** `up()` returns `[]` and writes nothing new.
- **Nothing to roll back:** `down()` returns `[]` when no batch exists.
- **A recorded migration missing from the array:** `down()` still deletes its
  bookkeeping row but has no `down()` to call, so the schema change is *not*
  reversed — keep old migrations in the array until they're fully retired.
- **Dialect default:** the `Migrator` constructor defaults to `"sqlite"` if you
  omit the second argument.

### Starting over

`reset()` calls `down()` until no batch is left, so it only unwinds as far as your
`down()` methods actually reach. `dropAllTables()` doesn't call them at all — it
finds every table in the current schema and drops it — which is the escape hatch
for when a `down()` is wrong, missing, or refers to a table a half-applied
migration never created. Postgres gets one `DROP TABLE ... CASCADE`, so the drop
order and any foreign keys between them stop mattering; SQLite has no `CASCADE`,
so foreign-key enforcement is suspended for the duration instead.

Both are destructive by design. The console commands that call them refuse to run
when `NODE_ENV=production` unless you pass `--force`.

## From the console

You rarely call the `Migrator` yourself — the console has the commands:

```bash
npm run keel migrate                 # run what's pending
npm run keel migrate -- --seed       # …then run DatabaseSeeder
npm run keel migrate:status          # which have run, which haven't
npm run keel migrate:rollback        # undo the last batch
npm run keel migrate:reset           # undo every batch
npm run keel migrate:refresh --seed  # reset, migrate, seed
npm run keel migrate:fresh --seed    # drop every table, migrate, seed
```

`migrate:refresh` unwinds through your `down()` methods; `migrate:fresh` ignores
them and drops the tables outright. Reach for `fresh` when `refresh` can't get you
back to empty. Both take `--force` to override the production guard.

## Dialect notes

The builder emits the right primary-key syntax per dialect —
`SERIAL`/`INTEGER PRIMARY KEY AUTOINCREMENT`/`INT AUTO_INCREMENT` — and maps
`boolean`/`timestamp`/`json` to each dialect's types (`BOOLEAN` vs `INTEGER`,
`TIMESTAMP` vs `DATETIME`, `JSONB` vs `TEXT`). Pass the dialect that matches your
connection — it must be the same one you gave [`setConnection`](./database.md).

---

## API reference

### `Migrator`

Runs migrations against a [`Connection`](./database.md#connection) and tracks
what's applied in a `migrations` table. You construct it directly.

#### `new Migrator(conn, dialect?)`

`new Migrator(conn: Connection, dialect?: Dialect)`

Creates a migrator bound to a connection and dialect (default `"sqlite"`).

```ts
const migrator = new Migrator(connection, "postgres");
```

**Notes:** the dialect drives both the generated DDL and the `?`→`$n` rewrite of
the migrator's own bookkeeping writes. It should match the connection you
registered with `setConnection`.

#### `up(migrations)`

`up(migrations: Migration[]): Promise<string[]>`

Runs every migration not yet recorded, in array order, under one new batch;
returns the names applied.

```ts
const applied = await migrator.up(migrations);
```

**Notes:** idempotent — already-run migrations (matched by `name`) are skipped.
Ensures the `migrations` table exists first. Not wrapped in a transaction: if one
migration throws, earlier ones in the same call stay applied.

#### `down(migrations)`

`down(migrations: Migration[]): Promise<string[]>`

Rolls back the most recent batch, calling each migration's `down()` in reverse
order; returns the names rolled back.

```ts
const rolled = await migrator.down(migrations);
```

**Notes:** returns `[]` when there's no batch to reverse. A recorded name absent
from `migrations` has its bookkeeping row deleted but no `down()` invoked, so its
schema change is not undone.

#### `reset(migrations)`

`reset(migrations: Migration[]): Promise<string[]>`

Rolls back every batch, newest first, by calling `down()` until nothing is left;
returns the names rolled back in the order they came off.

```ts
const rolled = await migrator.reset(migrations); // ["03_x", "02_y", "01_z"]
```

**Notes:** what `migrate:reset` and the first half of `migrate:refresh` run. It
only unwinds as far as your `down()` methods reach — for a guaranteed empty
database use `dropAllTables()`.

#### `dropAllTables()`

`dropAllTables(): Promise<string[]>`

Drops every table in the current schema, the `migrations` bookkeeping table
included; returns the names dropped.

```ts
await migrator.dropAllTables();
await migrator.up(migrations); // …what `migrate:fresh` does
```

**Notes:** never calls a migration's `down()`, which is the point — it's the way
back to empty when a `down()` is wrong or missing. Postgres uses a single
`DROP TABLE … CASCADE`; SQLite suspends foreign-key enforcement for the duration.
Destructive: the console command guards it behind `--force` in production.

#### `ran()`

`ran(): Promise<string[]>`

Returns the names of all migrations already applied.

```ts
const names = await migrator.ran();
const pending = migrations.filter((m) => !names.includes(m.name));
```

**Notes:** ensures the `migrations` table exists first, so it's safe to call on a
brand-new database (returns `[]`).

### `SchemaBuilder`

The object passed to a migration's `up`/`down`. **You don't construct it in
migrations** — the migrator creates one and hands it to your callbacks — though
it is exported and constructible (`new SchemaBuilder(conn, dialect)`) for
one-off scripts.

#### `createTable(name, build)`

`createTable(name: string, build: (table: TableBuilder) => void): Promise<void>`

Creates a table, using the `build` callback to describe its columns via a
[`TableBuilder`](#tablebuilder).

```ts
await schema.createTable("users", (t) => {
  t.id();
  t.string("email").unique();
  t.timestamps();
});
```

**Notes:** emits a single `CREATE TABLE` — it does not add `IF NOT EXISTS`, so
re-creating an existing table errors at the driver. Columns appear in declaration
order.

#### `dropTable(name)`

`dropTable(name: string): Promise<void>`

Drops a table if it exists.

```ts
await schema.dropTable("users");
```

**Notes:** uses `DROP TABLE IF EXISTS`, so it's safe to run when the table is
already gone — the typical `down()` for a `createTable`.

#### `raw(sql, bindings?)`

`raw(sql: string, bindings?: unknown[]): Promise<void>`

Runs arbitrary SQL through the connection — the escape hatch for anything the
builders don't cover.

```ts
await schema.raw("UPDATE users SET active = ? WHERE active IS NULL", [true]);
```

**Notes:** `bindings` defaults to `[]`. Placeholders are `?` on every dialect and
are rewritten to `$1, $2, …` on `postgres`, the same as the rest of Keel — so a
migration with bindings behaves identically whichever database it runs against.

#### `alterTable(name, build)`

`alterTable(name: string, build: (table: AlterTableBuilder) => void): Promise<void>`

Alter an existing table — the callback gets an [`AlterTableBuilder`](#altertablebuilder)
for adding, renaming, and dropping columns and indexes. Emits one dialect-aware
statement per operation, ordered so a dropped index precedes its column.

```ts
await schema.alterTable("users", (t) => {
  t.string("phone").nullable();
  t.renameColumn("name", "full_name");
  t.dropColumn("legacy");
});
```

### `TableBuilder`

Describes a table's columns. **You get one from the `createTable` callback** — it
is not constructed in migrations. Each column method (except `timestamps`) returns
a [`Column`](#column) for chaining modifiers.

#### `id(name?)`

`id(name?: string): Column`

Adds an auto-increment primary-key column (default name `"id"`).

```ts
t.id();          // "id"
t.id("uuid");    // custom name
```

**Notes:** maps to `SERIAL PRIMARY KEY` (postgres), `INT AUTO_INCREMENT PRIMARY
KEY` (mysql), or `INTEGER PRIMARY KEY AUTOINCREMENT` (sqlite). Never emitted as
`NOT NULL`; chaining modifiers on it is redundant.

#### `string(name, length?)`

`string(name: string, length?: number): Column`

Adds a `VARCHAR(length)` column (default length `255`).

```ts
t.string("email");
t.string("slug", 120);
```

#### `text(name)`

`text(name: string): Column`

Adds a `TEXT` column (unbounded string).

```ts
t.text("body");
```

#### `integer(name)` / `bigInteger(name)`

`integer(name: string): Column`
`bigInteger(name: string): Column`

Add an `INTEGER` / `BIGINT` column.

```ts
t.integer("user_id");
t.bigInteger("view_count");
```

#### `boolean(name)`

`boolean(name: string): Column`

Adds a boolean column — `BOOLEAN` on mysql/postgres, `INTEGER` on sqlite.

```ts
t.boolean("active").default(true);
```

#### `timestamp(name)`

`timestamp(name: string): Column`

Adds a timestamp column — `TIMESTAMP` on mysql/postgres, `DATETIME` on sqlite.

```ts
t.timestamp("published_at").nullable();
```

#### `json(name)`

`json(name: string): Column`

Adds a JSON column — `JSONB` on postgres, `TEXT` elsewhere.

```ts
t.json("meta").nullable();
```

**Notes:** on sqlite/mysql the value is stored as text; serialize/deserialize in
your app or [`Model`](./models.md) layer.

#### `timestamps()`

`timestamps(): void`

Adds nullable `created_at` and `updated_at` timestamp columns.

```ts
t.timestamps();
```

**Notes:** returns `void`, not a `Column` — there's nothing to chain. Both
columns are `nullable()`.

#### `toCreateSql(table, dialect)`

`toCreateSql(table: string, dialect: Dialect): string`

Renders the accumulated columns into a `CREATE TABLE` statement. Called
internally by `SchemaBuilder.createTable`; useful directly only if you're
generating DDL by hand.

```ts
const t = new TableBuilder();
t.id();
t.string("email");
t.toCreateSql("users", "postgres");
// CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL)
```

#### `index(columns, name?)` / `uniqueIndex(columns, name?)`

Add a (possibly composite) index or unique index; `columns` is a name or array.
Emitted as `CREATE [UNIQUE] INDEX` after the table. Auto-named unless `name` is
given.

```ts
t.index("email");
t.uniqueIndex(["team_id", "slug"]);
```

#### `foreign(column)`

`foreign(column: string): ForeignKeyBuilder`

Add a foreign key, built fluently and emitted inline in the `CREATE TABLE`.

```ts
t.foreign("team_id").references("id").on("teams").onDelete("cascade");
```

#### `columns`

`readonly columns: Column[]`

The `Column` instances added so far, in declaration order. Read-only inspection
seam; you rarely touch it.

### `AlterTableBuilder`

From the `alterTable` callback. Column methods (`string`, `integer`, …) **add**
columns; plus:

- `dropColumn(name)` — drop a column.
- `renameColumn(from, to)` — rename a column.
- `index(columns, name?)` / `uniqueIndex(columns, name?)` — add an index.
- `dropIndex(name)` — drop an index (runs before column drops).

### `ForeignKeyBuilder`

From `TableBuilder.foreign(column)`. Chainable: `references(column)`, `on(table)`,
`onDelete(action)`, `onUpdate(action)`.

### `Column`

A single column definition. **You get one from a `TableBuilder` method** (`t.string(...)` etc.) — you don't construct it in migrations. Modifier methods
return `this`, so they chain.

#### `nullable()`

`nullable(): this`

Marks the column nullable (drops the default `NOT NULL`).

```ts
t.text("bio").nullable();
```

#### `unique()`

`unique(): this`

Adds a `UNIQUE` constraint.

```ts
t.string("email").unique();
```

#### `default(value)`

`default(value: unknown): this`

Sets a default, rendered inline into the DDL.

```ts
t.boolean("active").default(true);
t.string("role").default("member");
```

**Notes:** strings are single-quoted (with no escaping — keep them constant),
booleans render as `1`/`0` on sqlite and `true`/`false` elsewhere, numbers pass
through via `String(value)`.

#### `toSql(dialect)`

`toSql(dialect: Dialect): string`

Renders this one column's DDL fragment (`name TYPE [NOT NULL] [UNIQUE] [DEFAULT
…]`). Called internally by `TableBuilder.toCreateSql`.

```ts
new Column("email", "string").unique().toSql("sqlite");
// email VARCHAR(255) NOT NULL UNIQUE
```

### Interfaces & types

#### `Migration`

```ts
interface Migration {
  name: string;
  up(schema: SchemaBuilder): void | Promise<void>;
  down(schema: SchemaBuilder): void | Promise<void>;
}
```

One schema change and its reversal. `name` is the identity recorded in the
`migrations` table (make it unique and sortable); `up` applies the change, `down`
reverses it. Both receive a [`SchemaBuilder`](#schemabuilder) and may be sync or
async. Implement it as a plain object literal:

```ts
const m: Migration = {
  name: "03_add_index",
  up: (s) => s.raw("CREATE INDEX idx_users_email ON users (email)"),
  down: (s) => s.raw("DROP INDEX idx_users_email"),
};
```

#### `Connection` / `Dialect`

Re-used from the [database](./database.md) layer. `Migrator` and `SchemaBuilder`
take a `Connection` (the driver seam) and a `Dialect`
(`"sqlite" | "mysql" | "postgres"`). See
[Database → Interfaces & types](./database.md#interfaces--types).
