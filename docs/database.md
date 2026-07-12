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

### Ready-made adapters

You don't have to hand-write the bridge for the common drivers — Keel ships
`Connection` adapters as optional subpath imports. Each takes your driver
instance and returns a `Connection`. They import no driver themselves (the client
is duck-typed), so Keel's core stays dependency-free and nothing is bundled until
you import it:

```ts
// Cloudflare D1 (sqlite)
import { d1Connection } from "@shaferllc/keel/db/d1";
setConnection(d1Connection(env.DB), "sqlite");

// Postgres — pg (Node) or @neondatabase/serverless (edge)
import { pgConnection } from "@shaferllc/keel/db/pg";
import { Pool } from "pg";
setConnection(pgConnection(new Pool({ connectionString })), "postgres");

// libSQL / Turso (sqlite, Node + edge)
import { libsqlConnection } from "@shaferllc/keel/db/libsql";
import { createClient } from "@libsql/client";
setConnection(libsqlConnection(createClient({ url, authToken })), "sqlite");
```

Install only the driver you use — it's a peer, not a Keel dependency. **Postgres
note:** `INSERT` returns an id only with a `RETURNING` clause, so `insertGetId()`
needs `RETURNING id` on Postgres; the D1 and libSQL adapters return the last
insert id natively.

## Multiple databases

`setConnection` registers the *default* connection. To talk to more than one
database at once — a Postgres primary and a SQLite/D1 cache, a separate reporting
warehouse, a per-tenant shard — register each by name with `addConnection`, and
each keeps its own dialect:

```ts
import { setConnection, addConnection } from "@shaferllc/keel/core";

setConnection(primary, "postgres");            // the default
addConnection("reporting", warehouse, "postgres");
addConnection("cache", d1Cache, "sqlite");
```

Route a single query with a second argument to `db()`:

```ts
await db("users").where("active", true).get();          // default
await db("events", "reporting").where("kind", "signup").count();
```

Or grab a reusable handle with `connection(name)` — it exposes `table()` plus the
raw `select`/`write` bridge, all dialect-adjusted for that database:

```ts
import { connection } from "@shaferllc/keel/core";

const reporting = connection("reporting");
await reporting.table("events").latest().limit(100).get();
await reporting.write("REFRESH MATERIALIZED VIEW daily_signups", []);
```

A whole [model](./models.md) can live on a connection — set `static connection`
and every query, save, and relation for that model routes there:

```ts
class Event extends Model {
  static table = "events";
  static connection = "reporting"; // reads, writes, and relations use "reporting"
}
```

`setDefaultConnection(name)` switches which registered connection the unnamed
`db(table)` (and any model without a `static connection`) uses — handy for
request-scoped tenant selection. `connectionNames()` lists what's registered.
An unregistered connection name doesn't fail when you *build* a query, only when
it runs — so a misconfigured name surfaces as a rejected read/write, not a
construction-time throw.

## Query builder

Start a query with `db(table)`, chain constraints (they return the builder, so
order doesn't matter), and finish with a terminal method. Nothing hits the
database until a terminal runs. Every value becomes a **binding**, never
string-interpolated SQL — the builder is injection-safe by construction. It's
driver-agnostic and edge-safe: the same chain compiles for sqlite, MySQL, and
Postgres.

```ts
import { db } from "@shaferllc/keel/core";

const active = await db("users")
  .where("active", true)
  .where("age", ">", 18)
  .orderBy("name")
  .limit(20)
  .get();
```

### Retrieving results

```ts
await db("users").get();                     // Row[]
await db("users").where("id", 1).first();    // Row | null
await db("users").where("id", 1).firstOrFail(); // Row, or throws NotFoundException
await db("users").find(1);                   // by primary key (default "id")
await db("users").where("email", e).sole();  // exactly one, else throws
await db("users").where("id", 1).value("email"); // one column of the first row
await db("posts").pluck("title");            // string[] of one column
await db("tags").orderBy("name").implode("name", ", "); // "a, b, c"
```

For large sets, `chunk` pages through without loading everything (return `false`
to stop early):

```ts
await db("users").orderBy("id").chunk(500, async (rows) => {
  for (const row of rows) await process(row);
});
```

### Aggregates

```ts
await db("orders").count();
await db("orders").where("paid", true).sum("total");
await db("orders").avg("total");   // also min(col), max(col)
await db("users").where("email", e).exists();       // boolean
await db("users").where("banned", true).doesntExist();
```

### Selects

```ts
db("users").select("id", "email");
db("users").select("id").addSelect("email");        // append, don't replace
db("orders").selectRaw("SUM(total) AS revenue");
db("users").distinct().select("country");
```

### Where clauses

```ts
db("users").where("votes", 100);                    // = is the default operator
db("users").where("votes", ">=", 100);
db("users").where("name", "like", "T%");

db("users").where("votes", 100).orWhere("name", "John");
db("users").whereNot("status", "cancelled");

db("users").whereIn("id", [1, 2, 3]).whereNotIn("id", [4]);
db("users").whereNull("deleted_at").whereNotNull("email_verified_at");
db("products").whereBetween("price", [10, 100]).whereNotBetween("stock", [0, 5]);
db("posts").whereLike("title", "%keel%");
db("events").whereColumn("updated_at", ">", "created_at");  // column vs column
db("users").whereRaw("score >= ? AND score <= ?", [10, 90]);
```

Every clause has an `orWhere…` twin — `orWhereIn`, `orWhereNull`,
`orWhereNotNull`, `orWhereBetween`, `orWhereColumn`, `orWhereLike`, `orWhereRaw`,
`orWhereNotIn`.

**Grouped clauses.** Pass a callback to `where`/`orWhere` to parenthesize a set
of conditions — the way to express `A AND (B OR C)`:

```ts
await db("users")
  .where("active", true)
  .where((q) => q.where("role", "admin").orWhere("role", "owner"))
  .get();
// … WHERE active = ? AND (role = ? OR role = ?)
```

### Ordering, grouping, limit & offset

```ts
db("users").orderBy("name").orderByDesc("created_at");
db("posts").latest();                 // ORDER BY created_at DESC (oldest() for ASC)
db("posts").orderByRaw("LENGTH(title) DESC");
db("users").inRandomOrder();          // dialect-aware RANDOM()/RAND()
db("users").reorder("name");          // clear existing ordering, then set

db("orders")
  .select("user_id")
  .selectRaw("SUM(total) AS spent")
  .groupBy("user_id")
  .having("spent", ">", 1000)         // also havingRaw(...), havingBetween(...)
  .get();

db("users").limit(10).offset(20);     // take(10)/skip(20) are aliases
db("users").forPage(3, 15);           // page 3, 15 per page
```

### Joins

```ts
await db("posts")
  .join("users", "posts.user_id", "users.id")   // INNER JOIN on equality
  .leftJoin("images", "images.post_id", "posts.id")
  .select("posts.title", "users.name")
  .get();
```

`rightJoin` and `crossJoin` round out the set. Joins with several `ON`
conditions aren't modelled — use `whereRaw` or a view.

### Conditional clauses

`when` / `unless` apply a callback based on a runtime value, so you build a query
without breaking the chain into `if`s. The callback receives the value:

```ts
await db("users")
  .when(search, (q, term) => q.whereLike("name", `%${term}%`))
  .unless(includeArchived, (q) => q.whereNull("archived_at"))
  .get();
```

### Inserts

```ts
await db("users").insert({ email, name });
const id = await db("users").insertGetId({ email, name });   // new primary key
await db("logs").insertOrIgnore({ key, value });             // skip unique conflicts
await db("users").upsert([{ id: 1, name: "Ada" }], ["id"], ["name"]); // insert/update
```

`upsert(rows, uniqueBy, update?)` inserts, updating the `update` columns (default:
everything not in `uniqueBy`) on a conflict — dialect-aware (`ON CONFLICT` /
`ON DUPLICATE KEY UPDATE`).

### Updates

```ts
await db("users").where("id", id).update({ name: "Grace" });
await db("users").updateOrInsert({ email }, { name });        // update match, else insert
await db("posts").where("id", id).increment("views");         // += 1
await db("posts").where("id", id).decrement("stock", 3, { updated_at: now });
await db("counters").incrementEach({ hits: 1, misses: 2 });   // several columns at once
```

### Deletes

```ts
await db("sessions").where("expires_at", "<", now).delete();
await db("cache").truncate();          // empty the table (DELETE on sqlite)
```

> **Guard your writes.** `update()`, `delete()`, and the increments apply to
> every row matching the current `where` clause — with none, that's the whole
> table. Scope every write unless you truly mean to touch every row.

### Pagination

```ts
const page = await db("posts").latest().paginate(2, 15);
// { data, total, perPage, currentPage, lastPage } — a COUNT plus a page query

const feed = await db("posts").latest().simplePaginate(2, 15);
// { data, perPage, currentPage, hasMore } — no COUNT; one extra row tells hasMore
```

### Pessimistic locking

Inside a [transaction](#transactions), lock the selected rows against concurrent
writes. No-ops on sqlite (which locks the whole database anyway):

```ts
await transaction(async () => {
  const row = await db("accounts").where("id", id).lockForUpdate().first(); // FOR UPDATE
  await db("accounts").where("id", id).update({ balance: row.balance - 10 });
});
// sharedLock() takes a read lock (FOR SHARE) instead.
```

### Debugging

```ts
db("users").where("active", true).toSql();       // "SELECT * FROM users WHERE active = ?"
db("users").where("active", true).getBindings(); // [true]
db("users").where("active", true).dump();        // logs SQL + bindings, returns the builder
db("users").where("active", true).dd();          // logs and throws (dump-and-die)
```

### Not (yet) modelled

Kept out on purpose, to stay driver-agnostic and honest about what compiles
everywhere: unions, subquery `where`/join builders (`whereExists`, `joinSub`),
the `whereDate`/`whereMonth`/… date-function family (no portable form across
dialects), and `cursor`/`lazy` streaming. Reach for `whereRaw`, a raw
`connection().select(sql)`, or a database view when you need them.

## Transactions

Two related writes should either both land or neither should. `transaction()`
commits when your callback returns and **rolls back if it throws**:

```ts
import { transaction, db } from "@shaferllc/keel/core";

await transaction(async () => {
  await db("orders").insert(order);
  await db("stock").where("id", id).decrement("count"); // a throw here undoes the insert
});
```

The error still reaches you — it's rethrown after the rollback. Nothing is
swallowed.

### Queries inside are ambient

You don't have to thread a transaction object through your code. `db()`, models,
and relations all pick up the open transaction automatically:

```ts
await transaction(async () => {
  const user = await User.create({ email }); // the model is in the transaction
  await user.related("posts").create({ title }); // so is the relation
  await db("audit").insert({ userId: user.id }); // and the raw builder
});
```

That works because the transaction lives in `AsyncLocalStorage`, not a module
global — so two requests running transactions at the same time can't steal each
other's connection.

If you'd rather be explicit, the callback gets a handle:

```ts
await transaction(async (tx) => {
  await tx.table("orders").insert(order);
  await tx.write("UPDATE stock SET count = count - 1 WHERE id = ?", [id]);
});
```

`tx.rollback()` abandons the transaction without committing. `inTransaction()`
tells you whether one is open.

### Nesting uses savepoints

A `transaction()` inside another doesn't open a second one — databases don't have
those. It takes a **savepoint**, so an inner failure rolls back only the inner
work and the outer transaction carries on:

```ts
await transaction(async () => {
  await db("orders").insert(order); // survives

  try {
    await transaction(async () => {
      await db("items").insert(item);
      throw new Error("out of stock"); // only this is rolled back
    });
  } catch {
    // handle it
  }

  await db("audit").insert(entry); // still in the outer transaction
});

// the outer transaction commits: the order and the audit row are both saved
```

Without savepoints, a nested helper's failure would silently abandon its caller's
writes too — which is the sort of bug you find in production, months later.

### Drivers and the pooling trap

A transaction needs every statement to run on **one** connection. A connection
*pool* hands each statement to whichever connection is free — so issuing `BEGIN`
through a pool wraps nothing: the `INSERT` after it can land on a different
connection entirely, the `COMMIT` commits nothing, and a failure half-writes.
It looks like it works. It doesn't.

So a pooled driver implements `begin()` on its `Connection`, checking one
connection out and running the whole transaction on it. Keel's Postgres adapter
does this automatically when you hand it a `Pool` (it checks for `connect()`), and
releases the connection afterwards even if the `COMMIT` throws.

| Driver | Transactions |
|--------|--------------|
| Postgres (`Pool`) | ✅ a dedicated connection is checked out |
| Postgres (`Client`), SQLite, libSQL | ✅ `BEGIN` / `COMMIT` on the one connection they have |
| **Cloudflare D1** | ❌ — no interactive transactions; use `database.batch([...])` |

D1 can't hold a transaction open across awaits, so `transaction()` on it **throws
a clear error** rather than letting a `BEGIN` fail cryptically. A transaction that
quietly isn't one is far worse than one that refuses to start.

Writing your own driver? Implement `begin(): Promise<TransactionConnection>` if it
pools. If it owns a single connection, you can leave it out and Keel will use
`BEGIN`/`COMMIT`/`ROLLBACK`.

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

`db<T extends Row = Row>(table: string, connectionName?: string): QueryBuilder<T>`

Starts a new query against `table`, on the default connection or a named one.
The optional type parameter types the rows returned by `get()`/`first()`.

```ts
db("users");                 // QueryBuilder<Row>, default connection
db<{ id: number }>("users"); // typed rows
db("events", "reporting");   // the "reporting" connection
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

**Notes:** registers the `"default"` connection — the last call wins. Calling
`db()` before any connection is registered throws `No database connection…` on
the first query. The dialect only changes placeholder rendering (`?` → `$1, $2`
for Postgres).

### `addConnection(name, conn, dialect?)`

`addConnection(name: string, conn: Connection, driverDialect?: Dialect): void`

Registers a *named* connection alongside the default and any others — the way to
use more than one database. Reach it with `db(table, name)`, `connection(name)`,
or a model's `static connection = name`.

```ts
addConnection("reporting", warehouse, "postgres");
```

### `connection(name?)`

`connection(name?: string): ConnectionHandle`

Returns a handle to a registered connection (or the default): `table(name)` to
start a query, `select`/`write` for raw SQL (dialect-adjusted, `?` placeholders),
and `dialect`.

```ts
const reporting = connection("reporting");
await reporting.table("events").count();
await reporting.select("SELECT 1", []);
```

### `setDefaultConnection(name)` · `connectionNames()` · `clearConnections()`

`setDefaultConnection(name: string)` picks which registered connection the
unnamed `db(table)` and connectionless models use (throws if `name` isn't
registered). `connectionNames()` returns the registered names.
`clearConnections()` unregisters everything — a test helper.

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

#### `whereColumn(first, operator?, second)` · `whereRaw(sql, bindings?)`

Compare two columns (no binding) or add a raw WHERE fragment with its own
bindings. `whereColumn("updated_at", ">", "created_at")`; `whereRaw("score >= ?", [10])`.

#### `join(table, first, operator?, second)` · `leftJoin(...)`

Add an `INNER JOIN` / `LEFT JOIN` on an equality (or the given operator).
Included in `get`, `count`, and aggregates. Qualify ambiguous columns
(`"posts.user_id"`).

#### `groupBy(...columns)` · `having(column, operator?, value)` · `distinct()`

`GROUP BY`, a bound `HAVING` predicate, and `SELECT DISTINCT`.

#### `orderByRaw(sql)` · `when(condition, then, otherwise?)`

A raw `ORDER BY` fragment; and conditional building — `then(query, value)` runs
only when `condition` is truthy, else `otherwise`.

#### `increment(column, amount?, extra?)` · `decrement(column, amount?, extra?)`

`increment(column: string, amount = 1, extra: Row = {}): Promise<WriteResult>`

Atomically `column = column ± amount` on matching rows, optionally setting other
columns in the same statement. Scope with `where`.

#### `upsert(rows, uniqueBy, update?)`

`upsert(rows: Row | Row[], uniqueBy: string[], update?: string[]): Promise<WriteResult>`

Insert rows, updating `update` columns (default: all non-unique) on a conflict
against `uniqueBy`. Dialect-aware: `ON CONFLICT … DO UPDATE` (sqlite/postgres) or
`ON DUPLICATE KEY UPDATE` (mysql).

#### `insertOrIgnore(rows)`

Insert one or more rows, skipping any that violate a unique constraint
(`INSERT OR IGNORE` / `INSERT IGNORE` / `ON CONFLICT DO NOTHING`).

#### `chunk(size, callback)`

`chunk(size: number, callback: (rows: T[]) => void | boolean | Promise<void | boolean>): Promise<void>`

Process results a page at a time so a large table never loads at once. Return
`false` from the callback to stop early. Pair with `orderBy` for a stable order.

#### `addSelect(...columns)` · `selectRaw(sql)`

Append columns to the SELECT list without replacing it; `selectRaw` appends a raw
expression (`selectRaw("SUM(total) AS revenue")`).

#### `orWhere` family · `whereNot(...)` · `whereNotBetween(column, [min, max])`

Every `where…` clause has an `orWhere…` twin joined with `OR` — `orWhereIn`,
`orWhereNotIn`, `orWhereNull`, `orWhereNotNull`, `orWhereBetween`,
`orWhereColumn`, `orWhereLike`, `orWhereRaw`. `whereNot` negates a comparison;
`whereNotBetween` is the inverse of `whereBetween`. Passing a **callback** to
`where`/`orWhere` groups its conditions in parentheses.

#### `orderByDesc(column)` · `reorder(column?, direction?)` · `inRandomOrder()`

Descending order; clear existing ordering (optionally setting a new one); random
order (dialect-aware `RANDOM()`/`RAND()`).

#### `groupByRaw(sql)` · `havingRaw(sql, bindings?)` · `havingBetween(column, [min, max])`

Raw `GROUP BY`, a raw/bound `HAVING`, and a `HAVING … BETWEEN`.

#### `take(n)` · `skip(n)` · `forPage(page, perPage?)`

Aliases for `limit`/`offset`, and limit+offset for a 1-based page.

#### `rightJoin(...)` · `crossJoin(table)`

`RIGHT JOIN` on an equality; `CROSS JOIN`.

#### `unless(condition, then, otherwise?)`

The inverse of `when` — runs `then` only when `condition` is falsy.

#### `find(id, key?)` · `firstOrFail()` · `sole()` · `doesntExist()` · `implode(column, glue?)`

Find by key (default `"id"`); first-or-throw; exactly-one-or-throw; the negation
of `exists`; and join one column's values into a string.

#### `simplePaginate(page?, perPage?)`

`simplePaginate(page = 1, perPage = 15): Promise<SimplePaginated<T>>`

A page without a `COUNT` — fetches one extra row to set `hasMore`. Cheaper than
`paginate` for "load more" UIs.

#### `lockForUpdate()` · `sharedLock()`

Add `FOR UPDATE` / `FOR SHARE` to the SELECT (inside a transaction). Ignored on
sqlite.

#### `updateOrInsert(match, values?)` · `truncate()` · `incrementEach(cols, extra?)` · `decrementEach(cols, extra?)`

Update the first match or insert `{ ...match, ...values }`; empty the table
(`DELETE` on sqlite); and step several numeric columns in one statement (`cols` is
an array — each by 1 — or a `{ column: amount }` map).

#### `toSql()` · `getBindings()` · `dump()` · `dd()`

The compiled `?`-placeholder SQL and its bindings, without executing; `dump` logs
them and returns the builder; `dd` logs and throws.

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
