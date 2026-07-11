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

## Attribute casts

By default columns are whatever the driver returns (SQLite hands back `1`/`0`
for booleans, strings for JSON). Declare `static casts` and values round-trip as
real JS types — cast when read (from the database or `fill`) and back to storable
primitives when written:

```ts
class Post extends Model {
  static table = "posts";
  static casts = {
    published: "boolean",   // 1/0        <-> true/false
    views: "int",           // "10"       ->  10
    meta: "json",           // '{"a":1}'  <-> { a: 1 }   (also "array")
    posted_at: "date",      // ISO string <-> Date
  };
}

const post = await Post.find(1);
post.published; // true (a real boolean)
post.meta;      // { … } (a real object)
post.published = false;
await post.save(); // stored as 0; meta re-serialized to a JSON string
```

Casts are what let a `boolean` or `json` column bind cleanly on real drivers,
which reject JS booleans and objects as parameters. Supported types: `int`,
`float`, `boolean`, `string`, `json` / `array`, `date`.

## Mass assignment

`create()` and `fill()` take untrusted input (often a request body), so they're
guarded. Whitelist columns with `static fillable`, or blacklist with
`static guarded` — columns outside the allowance are silently dropped:

```ts
class Post extends Model {
  static table = "posts";
  static fillable = ["title", "body"];   // only these are mass-assignable
  // — or —
  static guarded = ["is_admin"];         // everything except these
}

await Post.create({ title: "Hi", is_admin: true }); // is_admin dropped
post.fill(request.all());                            // safe from over-posting
post.forceFill({ is_admin: true });                  // explicit bypass
```

With neither declared, all attributes are assignable (the default). Direct
property assignment (`post.is_admin = true`) is never guarded — guarding is only
about *mass* assignment from untrusted data.

## Serializing

```ts
user.toJSON();          // a plain object of the (cast) attributes + loaded relations
return json(user);       // works directly — json() serializes it
user.fill({ name: "X" }); // merge mass-assignable attributes without saving
```

## Relationships

Define a relationship as a method that returns one of `hasMany` / `hasOne` /
`belongsTo` / `belongsToMany`. Keys follow conventions (the owning model's name
plus its primary key — `user_id`) but every one is overridable.

```ts
class User extends Model {
  static table = "users";
  posts() { return this.hasMany(Post); }        // posts.user_id = users.id
  profile() { return this.hasOne(Profile); }     // profiles.user_id = users.id
  roles() { return this.belongsToMany(Role); }   // role_user pivot
}

class Post extends Model {
  static table = "posts";
  author() { return this.belongsTo(User); }      // posts.user_id -> users.id
}
```

Relations are **awaitable** — read them lazily with `await`:

```ts
const posts = await user.posts();     // Post[]
const author = await post.author();   // User | null
```

Need to constrain or sort? `.query()` hands back the underlying query builder:

```ts
const recent = await user.posts().query().orderBy("created_at", "desc").limit(5).get();
```

### Eager loading (avoiding N+1)

Loading a relation per model in a loop is N+1 queries. `Model.load()` fetches
them all with one extra query per relation, using `whereIn`:

```ts
const users = await User.all();
await User.load(users, "posts", "roles"); // 2 extra queries total, not 2×N

users[0].getRelation("posts"); // Post[]
users[0].toJSON();             // includes `posts` and `roles`
```

Loaded relations are stored off the model, so they never leak into `save()`,
and `toJSON()` serializes them (nested models included).

### Many-to-many

`belongsToMany` reads through a pivot table (default name: the two table names
sorted and joined, e.g. `role_user`) and can write it too:

```ts
await user.roles().attach(roleId);   // insert a pivot row
await user.roles().detach(roleId);   // remove one (or all, with no argument)
await user.roles().sync([1, 2, 3]);  // make the pivot contain exactly these
```

Every relation runs on the driver-agnostic query builder — no JOINs, no driver
imports — so relationships stay edge-safe. Overriding keys:

```ts
this.hasMany(Post, "authored_by", "id");
this.belongsTo(User, "owner_id", "id");
this.belongsToMany(Role, "user_roles", "user_id", "role_id");
```

## What this is (and isn't)

This is a deliberately small active-record — enough for CRUD, relationships,
casts, and simple queries without an ORM dependency. Nested eager loading
(`posts.comments`) and query-time `with()` aren't here yet. For complex schemas
you can always drop to `db()` or your driver directly.
