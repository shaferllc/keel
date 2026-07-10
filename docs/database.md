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

The dialect only affects placeholder style (`?` vs Postgres `$1`).

## Querying

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

### Builder methods

| Read | Write |
|------|-------|
| `where` · `orWhere` · `whereIn` | `insert(data)` · `insertGetId(data)` |
| `whereNull` · `whereNotNull` | `update(data)` |
| `orderBy` · `limit` · `offset` · `select` | `delete()` |
| `get` · `first` · `count` · `exists` | |

## Writing

```ts
const id = await db("users").insertGetId({ email, name });
await db("users").where("id", id).update({ name: "Grace" });
await db("users").where("id", id).delete();
```

Everything is parameterized — values become bindings, never string-interpolated
SQL — so it's injection-safe by construction.

## Typed rows

Pass a row type for typed results:

```ts
interface User { id: number; email: string }
const user = await db<User>("users").where("id", 1).first(); // User | null
```

> An active-record `Model` layer and migrations build on this — see the roadmap.
