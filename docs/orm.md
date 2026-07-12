# ORM

Keel's ORM is a compact **active record** over the [query builder](./query-builder.md):
a model is a class pointed at a table, and its rows come back as typed objects
with methods. There's no mapper to configure and no separate schema layer — a
model *is* the row plus behaviour. It runs on whatever [connection](./database.md)
you registered, so the same code works on Node and the edge.

```ts
import { Model } from "@shaferllc/keel/core";

class User extends Model {
  static table = "users";
  declare id: number;
  declare email: string;

  posts() { return this.hasMany(Post); }
}

const user = await User.find(1);
await user.posts();                 // relations are awaitable
if (await user.subscribed()) { /* … */ }
```

This page is the map; each capability has a deep-dive in **[Models](./models.md)**.

## What the ORM gives you

| Area | What you get | Guide |
|------|--------------|-------|
| **CRUD** | `find` / `all` / `create` / `save` / `update` / `delete`, `firstOrCreate`, `updateOrCreate` | [Models → Reading/Writing](./models.md#reading) |
| **Casts** | `boolean` / `int` / `json` / `date` … columns round-trip as real JS types | [Models → Attribute casts](./models.md#attribute-casts) |
| **Mass assignment** | `fillable` / `guarded` allow/deny lists guard untrusted input | [Models → Mass assignment](./models.md#mass-assignment) |
| **Serialization** | `hidden` / `visible` / `appends` shape `toJSON()` | [Models → Serializing](./models.md#serializing) |
| **Relationships** | `hasOne` / `hasMany` / `belongsTo` / `belongsToMany` + polymorphic `morphOne` / `morphMany` / `morphTo` | [Models → Relationships](./models.md#relationships) |
| **Eager loading** | `with("posts.comments")` (nested), `withCount`, `Model.load` — no N+1 | [Models → Eager loading](./models.md#eager-loading-avoiding-n1) |
| **Relationship queries** | `whereHas` / `has` / `doesntHave` | [Models → Querying relationships](./models.md#querying-relationships-with-withcount-wherehas) |
| **Lifecycle events** | `creating`/`saved`/`deleting`/… hooks and observers, inherited by subclasses | [Models → Lifecycle events](./models.md#lifecycle-events) |
| **Scopes** | global scopes (tenancy, published-only) + local scope methods | [Models → Query scopes](./models.md#query-scopes) |
| **Soft deletes** | `deleted_at`, `withTrashed` / `onlyTrashed` / `restore` / `forceDelete` | [Models → Soft deletes](./models.md#soft-deletes) |

## How it relates to the rest

- The **[query builder](./query-builder.md)** is the layer underneath. `Model.query()`
  returns a model-aware builder, and everything an ORM query can't express
  (raw joins, aggregates, bulk writes) is one `db()` call away.
- **[Migrations](./migrations.md)** define the tables models read and write.
- **[Factories & seeders](./factories.md)** generate model rows for tests and demos.
- **[API resources](./api-resources.md)** turn models into a REST API; **[transformers](./transformers.md)**
  control their serialized shape at the boundary.

## When to drop down

The ORM is deliberately small — enough for CRUD, relationships, and the common
query shapes without an ORM dependency. For a gnarly one-off report, reach for
the [query builder](./query-builder.md) or a raw `connection().select(sql)`; the
model layer never gets in the way.
