# Models

`Model` is a tiny active-record layer over the [query builder](./database.md).
Subclass it, point it at a table, and you get `find` / `all` / `create` /
`save` / `delete` — no ORM to configure. It runs through whatever
[connection](./database.md) you registered, so it works on Node and the edge.

## Define a model

```ts
import { Model } from "@shaferllc/keel/core";

export class User extends Model {
  static table = "users";
  static primaryKey = "id"; // default

  declare id: number;
  declare email: string;
  declare name: string;
}
```

Use `declare` for columns — it types the properties without emitting fields that
would shadow the row values the model is hydrated with.

## Reading

```ts
await User.all();                 // User[]
await User.find(1);               // User | null
await User.findOrFail(1);         // User (throws NotFoundException if missing)
await User.first();               // User | null
await User.where("active", true); // User[]
```

For anything richer, `User.query()` returns the underlying query builder:

```ts
const rows = await User.query().where("age", ">", 18).orderBy("name").limit(10).get();
```

## Writing

```ts
// create
const user = await User.create({ email: "a@b.com", name: "Ada" });

// update — change attributes, then save
user.name = "Grace";
await user.save();

// new instance — save() inserts and back-fills the primary key
const draft = new User({ email: "new@x.com" });
await draft.save();
draft.id; // now set

// delete
await user.delete();
```

`save()` inserts when there's no primary key and updates when there is — one
method for both.

## Serializing

```ts
user.toJSON();          // a plain object of the attributes
return json(user);       // works directly — json() serializes it
user.fill({ name: "X" }); // merge attributes without saving
```

## What this is (and isn't)

This is a deliberately small active-record — enough for CRUD and simple queries
without an ORM dependency. It doesn't do relationships, eager loading, or
migrations yet (on the roadmap). For complex schemas you can always drop to
`db()` or your driver directly.
