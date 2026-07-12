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

## Queries & models

Building and running queries — `where`, joins, aggregates, inserts, updates,
pagination — lives in the [Query Builder](./query-builder.md) guide. The
[ORM](./orm.md) adds an active-record layer (models, relationships, events,
scopes) on top of the same builder.

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
