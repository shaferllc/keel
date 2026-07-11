# Database

Keel ships a small, **driver-agnostic query builder**. It generates
parameterized SQL and runs it through a `Connection` you provide — so it works
with any driver (Cloudflare D1, Neon/Postgres, PlanetScale, Turso, better-sqlite3,
`pg`). The core never imports a database driver, so it stays edge-safe.

## Connect

Register a connection once, in a service provider. The `Connection` interface is
two methods — adapt them to your driver:

```ts
import { setConnection, type Connection } from "@shaferllc/keel/core";

const connection: Connection = {
  select: (sql, bindings) => d1.prepare(sql).bind(...bindings).all().then((r) => r.results),
  write: async (sql, bindings) => {
    const r = await d1.prepare(sql).bind(...bindings).run();
    return { rowsAffected: r.meta.changes, insertId: r.meta.last_row_id };
  },
};

setConnection(connection, "sqlite"); // "sqlite" | "mysql" | "postgres"
```

The dialect only affects placeholder style (`?` vs Postgres `$1`). `select`
returns the rows (`Row[]`); `write` returns a `WriteResult` (`rowsAffected`,
optional `insertId`). Everything the builder does bottoms out in these two
methods, which is why the same app runs on Node and the edge — only the
connection changes. The type parameter on `db<T>()` types the *results*; the
`Connection` itself just deals in `Row`s.

## Querying

Start a query with `db(table)`, chain constraints, and finish with a terminal
method (`get`, `first`, `count`, `exists`):

```ts
import { db } from "@shaferllc/keel/core";

await db("users").where("active", true).orderBy("name").get();
await db("users").where("id", 1).first();          // row | null
await db("users").where("age", ">", 18).count();
await db("posts").whereIn("id", [1, 2, 3]).get();
await db("posts").whereNull("deleted_at").limit(20).offset(40).get();

await db("orders")
  .select("id", "total")
  .where("status", "paid")
  .orWhere("status", "shipped")
  .get();
```

Constraint methods return the builder, so they chain in any order; the query
isn't sent until you call a terminal method. Multiple `where` calls combine with
`AND`; `orWhere` joins with `OR`.

## Writing

```ts
const id = await db("users").insertGetId({ email, name });
await db("users").where("id", id).update({ name: "Grace" });
await db("users").where("id", id).delete();
```

Everything is parameterized — values become bindings, never string-interpolated
SQL — so it's injection-safe by construction. Writes return a `WriteResult`;
`insertGetId` unwraps it to just the new id.

> **Guard your writes.** `update()` and `delete()` apply to every row that
> matches the current `where` clause — with no `where`, that's the whole table.
> Always scope a write with `where` unless you truly mean to touch every row.

## Typed rows

Pass a row type for typed results — it flows through to `get()` and `first()`:

```ts
type User = {
  id: number;
  email: string;
};
const user = await db<User>("users").where("id", 1).first(); // User | null
const all = await db<User>("users").get(); // User[]
```

The type is a compile-time convenience; it doesn't validate the shape at runtime.

> Use a `type` alias, not an `interface`, for the row type. The builder's type
> parameter is constrained to `Row` (`Record<string, unknown>`), which a `type`
> satisfies via an implicit index signature but an `interface` does not.

## Related

An active-record [`Model`](./models.md) layer and [migrations](./migrations.md)
build on this builder — reach for them for CRUD and schema work, and drop back to
`db()` for anything they don't cover.

---

## API reference

### `db(table)`

`db<T extends Row = Row>(table: string): QueryBuilder<T>`

Starts a new query against `table`. The optional type parameter types the rows
returned by `get()`/`first()`.

```ts
db("users");             // QueryBuilder<Row>
db<{ id: number }>("users"); // typed rows
```

**Notes:** returns a fresh builder each call — nothing is shared between queries.
No SQL runs until a terminal method (`get`/`first`/`count`/`exists`) or a write
(`insert`/`update`/`delete`) is awaited.

### `setConnection(conn, dialect?)`

`setConnection(conn: Connection, driverDialect?: Dialect): void`

Registers the connection every `db()` query runs through, plus the dialect
(default `"sqlite"`).

```ts
setConnection(connection, "postgres");
```

**Notes:** global — the last call wins. Calling `db()` before `setConnection`
throws `No database connection…` on the first query. The dialect only changes
placeholder rendering (`?` → `$1, $2` for Postgres).

### `QueryBuilder`

Returned by `db()`. Constraint methods return `this` (chainable); terminal
methods return a promise. You never construct it directly.

#### `select(...columns)`

`select(...columns: string[]): this`

Restricts the selected columns. With no arguments, selects `*`.

```ts
db("users").select("id", "email").get();
```

**Notes:** column names are interpolated as-is (they are not parameterized), so
never pass user input as a column name. Calling it again replaces the prior
selection.

#### `where(column, value)` / `where(column, operator, value)`

`where(column: string, value: unknown): this`
`where(column: string, operator: Operator, value: unknown): this`

Adds an `AND` condition. The two-argument form uses `=`; the three-argument form
takes an explicit operator.

```ts
db("users").where("active", true);
db("users").where("age", ">", 18);
db("users").where("email", "like", "%@example.com");
```

**Notes:** `Operator` is `"=" | "!=" | "<" | "<=" | ">" | ">=" | "like"`. Values
are always parameterized. Chaining multiple `where`s combines them with `AND`.

#### `orWhere(column, value)` / `orWhere(column, operator, value)`

`orWhere(column: string, value: unknown): this`
`orWhere(column: string, operator: Operator, value: unknown): this`

Same as `where`, but joins the condition with `OR`.

```ts
db("orders").where("status", "paid").orWhere("status", "shipped").get();
```

**Notes:** conditions are combined left-to-right without grouping parentheses, so
mixing `where` and `orWhere` follows SQL's `AND`/`OR` precedence — group complex
logic in separate queries if you need explicit parenthesization.

#### `whereIn(column, values)`

`whereIn(column: string, values: unknown[]): this`

Matches rows where `column` is any of `values` (`AND`-joined).

```ts
db("posts").whereIn("id", [1, 2, 3]).get();
```

**Notes:** each value becomes its own placeholder. An empty array produces
`IN ()`, which most engines reject — guard against empty lists yourself.

#### `whereNull(column)` / `whereNotNull(column)`

`whereNull(column: string): this`
`whereNotNull(column: string): this`

Adds an `AND` `IS NULL` / `IS NOT NULL` condition — no binding.

```ts
db("posts").whereNull("deleted_at").get();
db("users").whereNotNull("verified_at").get();
```

#### `orderBy(column, direction?)`

`orderBy(column: string, direction?: "asc" | "desc"): this`

Adds an `ORDER BY` clause (default `"asc"`). Call it repeatedly for multiple sort
keys, applied in call order.

```ts
db("users").orderBy("last_name").orderBy("created_at", "desc").get();
```

**Notes:** the column is interpolated, not parameterized — don't pass user input.

#### `limit(n)` / `offset(n)`

`limit(n: number): this`
`offset(n: number): this`

Caps the number of rows / skips the first `n`. Together they paginate.

```ts
db("posts").limit(20).offset(40).get(); // page 3, 20 per page
```

**Notes:** `first()` sets `limit(1)` internally, overriding any prior `limit`.

#### `get()`

`get(): Promise<T[]>`

Runs the SELECT and returns all matching rows.

```ts
const rows = await db("users").where("active", true).get();
```

#### `first()`

`first(): Promise<T | null>`

Runs the SELECT with `LIMIT 1` and returns the first row, or `null`.

```ts
const user = await db("users").where("email", email).first();
```

**Notes:** overrides any `limit` you set. Returns `null` (not `undefined`) when
nothing matches.

#### `count()`

`count(): Promise<number>`

Returns `COUNT(*)` for the current `where` clause.

```ts
const active = await db("users").where("active", true).count();
```

**Notes:** ignores `select`, `orderBy`, `limit`, and `offset` — it counts matching
rows, not the paginated slice.

#### `exists()`

`exists(): Promise<boolean>`

`true` when at least one row matches — a `count() > 0` shorthand.

```ts
if (await db("users").where("email", email).exists()) { /* taken */ }
```

#### `insert(data)`

`insert(data: Row): Promise<WriteResult>`

Inserts one row and returns write metadata.

```ts
const result = await db("users").insert({ email, name });
result.rowsAffected; // 1
result.insertId;     // driver-dependent
```

**Notes:** column order follows `Object.keys(data)`. `insertId` is only populated
if the driver reports it in `WriteResult`.

#### `insertGetId(data)`

`insertGetId(data: Row): Promise<number | string | undefined>`

Inserts one row and returns just its new id (`insert` unwrapped).

```ts
const id = await db("users").insertGetId({ email, name });
```

**Notes:** returns `undefined` when the driver doesn't report an `insertId`.

#### `update(data)`

`update(data: Row): Promise<WriteResult>`

Updates every row matching the `where` clause, setting the given columns.

```ts
const r = await db("users").where("id", 1).update({ name: "Grace" });
r.rowsAffected; // rows changed
```

**Notes:** with no `where`, updates the entire table. Bindings are the new values
followed by the where-clause values.

#### `delete()`

`delete(): Promise<WriteResult>`

Deletes every row matching the `where` clause.

```ts
await db("sessions").where("expires_at", "<", now).delete();
```

**Notes:** with no `where`, empties the table. There's no soft-delete here — pair
with a `deleted_at` column and `whereNull` if you want one.

### Interfaces & types

#### `Connection`

```ts
interface Connection {
  select<T = Row>(sql: string, bindings: unknown[]): Promise<T[]>;
  write(sql: string, bindings: unknown[]): Promise<WriteResult>;
}
```

The seam between the builder and your driver. `select` runs any row-returning
query and resolves to the rows; `write` runs an INSERT/UPDATE/DELETE and resolves
to a `WriteResult`. Implement it once per driver — the two-method surface is
deliberately tiny so any driver (or a mock in tests) fits.

```ts
const mock: Connection = {
  select: async () => [{ id: 1 }],
  write: async () => ({ rowsAffected: 1, insertId: 1 }),
};
```

#### `WriteResult`

```ts
interface WriteResult {
  rowsAffected: number;
  insertId?: number | string;
}
```

Returned by `write` (and thus `insert`/`update`/`delete`). `insertId` is optional
because not every driver or statement produces one.

#### `Row`

`type Row = Record<string, unknown>`

A database row — the default shape for query results and write payloads.

#### `Dialect`

`type Dialect = "sqlite" | "mysql" | "postgres"`

Selects placeholder rendering. Only Postgres differs (`$1, $2, …`); the others
use `?`.

#### `Operator`

`type Operator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like"`

The comparison operators accepted by the three-argument `where`/`orWhere`.
