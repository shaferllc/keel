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
method for both. `update(attrs)` is `fill` + `save`, and `refresh()` reloads a
model's columns from the database:

```ts
await user.update({ name: "Grace" });   // mass-assign + save
await user.refresh();                    // re-read the row
```

### Find-or-create

```ts
// Return the first matching row, or create it from { ...match, ...values }.
const tag = await Tag.firstOrCreate({ slug: "keel" }, { name: "Keel" });
// Update the match if it exists, otherwise create it.
const sub = await Subscription.updateOrCreate({ user_id: 1 }, { plan: "pro" });
```

## Timestamps

Set `static timestamps = true` and Keel manages `created_at` / `updated_at` — both
on insert, just `updated_at` on update:

```ts
class Post extends Model {
  static table = "posts";
  static timestamps = true;
  // override the column names if yours differ:
  // static createdAtColumn = "inserted_at";
  // static updatedAtColumn = "modified_at";
}

const post = await Post.create({ title: "Hi" });
post.created_at; // set
post.updated_at; // set (same instant)
```

## Pagination

`Model.paginate(page, perPage)` returns a page of models plus metadata:

```ts
const { data, total, currentPage, lastPage, perPage } = await Post.paginate(2, 15);
```

`data` is `Post[]`; the rest is pagination state (defaults: page `1`, `15` per
page). The query builder has the same `paginate()` if you're not using models.

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
  } as const;
}

const post = await Post.find(1);
post.published; // true (a real boolean)
post.meta;      // { … } (a real object)
post.published = false;
await post.save(); // stored as 0; meta re-serialized to a JSON string
```

The `as const` keeps the string literals from widening to `string` so the map
still satisfies `Casts` (`Record<string, CastType>`) — without it TypeScript
infers `string` values and the assignment to the base `static casts` fails.

Casts are what let a `boolean` or `json` column bind cleanly on real drivers,
which reject JS booleans and objects as parameters. Supported types: `int` (alias
`integer`), `float` (alias `number`), `boolean` (alias `bool`), `string`, `json`
/ `array`, `date`. Both directions are null-safe — `null`/`undefined` pass
through uncast — and reads are tolerant of already-cast input, so hydrating a row
twice or casting a value that's already a `Date` is a no-op.

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

Control what `toJSON()` exposes with three statics. `hidden` strips columns;
`visible` is an allowlist that wins over everything; `appends` adds computed
attributes — a getter or a zero-arg method on the model:

```ts
class User extends Model {
  static table = "users";
  static hidden = ["password"];       // never serialized
  static appends = ["fullName"];      // added to the output
  get fullName() { return `${this.first} ${this.last}`; }
}
```

## Lifecycle events

A model fires events as it is retrieved, saved, and deleted. Hook onto them to
slug a title, bust a cache, or cascade — without touching every call site. The
`*ing` events are **cancelable**: a hook returning `false` aborts the write.

```ts
User.creating((user) => { user.uuid = crypto.randomUUID(); });
User.saved((user) => cache().forget(`user:${user.id}`));
User.deleting((user) => (user.isRoot ? false : undefined)); // veto

// Or group them in an observer:
User.observe({
  creating: (u) => { u.uuid = crypto.randomUUID(); },
  deleted:  (u) => audit(`deleted ${u.id}`),
});
```

Events: `retrieved`, `creating`/`created`, `updating`/`updated`,
`saving`/`saved`, `deleting`/`deleted`, `restoring`/`restored`.

Hooks **inherit**, ancestors first: a hook on a base class fires for every model
that extends it. That's what lets a base class do real work — a `creating` hook
that stamps a tenant id is useless if subclasses never fire it.

## Query scopes

A **global scope** constrains every query a model builds — the base for
multi-tenancy, published-only reads, and soft deletes:

```ts
Post.addGlobalScope("published", (q) => q.where("published", true));
await Post.all();        // only published
await Post.query().where("author_id", 1).get();  // still only published
```

Scopes **inherit**. A scope declared on a base class constrains every model that
extends it — which is what makes a single tenant-scoped base class possible:

```ts
class TenantModel extends Model {}
TenantModel.addGlobalScope("tenant", (q) => q.where("teamId", currentTeamId()));

class Post extends TenantModel {}   // scoped, without repeating yourself
```

Scopes from several levels all apply, and a subclass overrides an ancestor's scope
by reusing its name — the nearest declaration wins.

### Escaping a scope

```ts
await Post.withoutGlobalScope("tenant").get();   // one named scope
await Post.withoutGlobalScopes().get();          // all of them
```

Escaping is deliberately explicit, and worth keeping that way. A query that steps
outside a tenancy scope is exactly the thing you want to be able to *find* — so it
should be typed out and greppable, never something you arrive at by forgetting a
`where`.

A **local scope** is just a static method returning a query — no framework
feature needed:

```ts
class Post extends Model {
  static popular() { return this.query().where("views", ">", 1000); }
}
await Post.popular().orderBy("views", "desc").get();
```

## Soft deletes

Opt in with `static softDeletes = true` and a `deleted_at` column. `delete()`
then sets the timestamp instead of removing the row, and a global scope hides
soft-deleted rows from every query.

```ts
class User extends Model {
  static table = "users";
  static softDeletes = true;
  static casts = { deleted_at: "date" };
}

await user.delete();          // sets deleted_at; row stays in the table
user.trashed();               // true
await User.find(user.id);     // null — hidden by the scope

await User.withTrashed().get();   // include soft-deleted
await User.onlyTrashed().get();   // only soft-deleted
await user.restore();             // clear deleted_at
await user.forceDelete();         // remove the row for good
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

### Querying relationships (`with`, `withCount`, `whereHas`)

`Model.query()` returns a model-aware builder with the relationship operations a
raw query can't express. `with()` eager-loads (dotted paths nest), `withCount()`
adds a `<relation>_count`, and `has`/`whereHas`/`doesntHave` filter by whether a
related row exists:

```ts
const users = await User.query()
  .where("active", true)
  .with("posts.comments")                       // nested eager load
  .withCount("posts")                            // users[i].posts_count
  .whereHas("posts", (q) => q.where("published", true))
  .get();

await User.has("posts").get();        // users with at least one post
await User.doesntHave("posts").get(); // users with none
```

`with`/`withCount`/`whereHas`/`has`/`doesntHave` are also static shortcuts
(`User.with(...)`, `User.whereHas(...)`). Existence filters use the same
driver-agnostic two-query strategy as the relations themselves — no JOIN.

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

### Polymorphic

A polymorphic relation lets one model belong to more than one type. The related
rows carry `<name>_id` + `<name>_type`; register each owner type so `morphTo`
can resolve it:

```ts
class Post extends Model {
  comments() { return this.morphMany(Comment, "commentable"); }
}
class Video extends Model {
  comments() { return this.morphMany(Comment, "commentable"); }
}
class Comment extends Model {
  commentable() { return this.morphTo("commentable"); } // resolves back to Post or Video
}

registerMorphType("Post", Post);
registerMorphType("Video", Video);

await post.comments().create({ body: "nice" }); // sets commentable_id/_type
const owner = await comment.commentable();       // Post | Video | null
```

`morphOne` is the one-to-one variant. Eager loading (`Model.load` / `with`) works
across mixed types.

## What this is (and isn't)

This is a compact active-record — CRUD, lifecycle events, scopes, soft deletes,
serialization control, eager loading (including nested `with("posts.comments")`),
relationship queries (`whereHas`/`withCount`), and polymorphic relations — all on
a driver-agnostic query builder, no ORM dependency. For complex one-off queries
you can always drop to `db()` or your driver directly.

---

## API reference

Everything below imports from `@shaferllc/keel/core`.

### `Model` — static methods

You call these on your subclass (`User.find(1)`), not on `Model` itself. Each
read hydrates rows into instances of the class it was called on.

#### `Model.query()`

`static query(): QueryBuilder`

Returns a raw [query builder](./database.md) scoped to the model's table — the
escape hatch for anything the finders don't cover.

```ts
const rows = await User.query().where("age", ">", 18).orderBy("name").limit(10).get();
```

**Notes:** returns plain `Row`s, not hydrated models — map them through
`new User(row)` yourself if you need instances.

#### `Model.all()`

`static all<T extends Model>(this: ModelClass<T>): Promise<T[]>`

Fetches every row in the table as hydrated models.

```ts
const users = await User.all(); // User[]
```

**Notes:** no `where`, no `limit` — it reads the whole table. Reach for `query()`
when that's too much.

#### `Model.find(id)`

`static find<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T | null>`

Looks a model up by primary key. Resolves to `null` when nothing matches.

```ts
const user = await User.find(1); // User | null
```

**Notes:** matches on `static primaryKey` (default `"id"`). Returns `null`, not
`undefined`.

#### `Model.findOrFail(id)`

`static findOrFail<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T>`

Like `find`, but throws instead of returning `null`.

```ts
const user = await User.findOrFail(1); // User (or throws)
```

**Notes:** throws `NotFoundException` with message `"<ClassName> <id> not
found"`. `NotFoundException` is an `HttpException` (status 404), so an HTTP
handler surfaces it as a 404 without extra work.

#### `Model.first()`

`static first<T extends Model>(this: ModelClass<T>): Promise<T | null>`

Returns the first row in the table (no ordering), or `null`.

```ts
const anyUser = await User.first(); // User | null
```

**Notes:** unordered — the "first" row is whatever the driver returns first. Add
your own `orderBy` via `query().first()` when order matters.

#### `Model.where(column, value)`

`static where<T extends Model>(this: ModelClass<T>, column: string, value: unknown): Promise<T[]>`

A convenience finder for a single equality condition. Runs immediately and
returns hydrated models.

```ts
const active = await User.where("active", true); // User[]
```

**Notes:** equality only, and it's a terminal call — it returns a `Promise`, not
a builder, so you can't chain more constraints onto it. Use `query()` for
operators, `OR`, ordering, or limits.

#### `Model.create(attributes)`

`static create<T extends Model>(this: ModelClass<T>, attributes: Row): Promise<T>`

Mass-assigns `attributes` (filtered through `fillable`/`guarded`), inserts one
row, and returns the hydrated model with its new primary key set.

```ts
const user = await User.create({ email: "a@b.com", name: "Ada" });
user.id; // populated from insertId
```

**Notes:** attributes outside the mass-assignment allowance are silently dropped
before the insert. Values are cast to storable primitives on the way in. If the
driver doesn't report an `insertId`, the primary key stays unset.

#### `Model.load(models, ...names)`

`static load<T extends Model>(models: T[], ...names: string[]): Promise<T[]>`

Eager-loads one or more relationships onto an array of already-fetched models —
one extra query per relation, the fix for N+1. Returns the same array.

```ts
const users = await User.all();
await User.load(users, "posts", "roles"); // 2 extra queries, not 2×N
users[0].getRelation("posts"); // Post[]
```

**Notes:** each name must be a relationship method on the model; an unknown name
throws `"<ClassName> has no relation "<name>""`. An empty `models` array is
returned untouched (no queries). Loaded results are stored off the model (see
`getRelation`) and never leak into `save()`.

#### `Model.filterFillable(attributes)`

`static filterFillable(attributes: Row): Row`

Returns a copy of `attributes` keeping only what mass-assignment allows — the
guard `create`/`fill` apply. Rarely called directly.

```ts
const safe = Post.filterFillable(request.all());
```

**Notes:** if `fillable` is non-empty it's an allowlist; else if `guarded` is
non-empty it's a denylist; with neither, everything passes. `fillable` wins when
both are set.

#### `Model.toDatabase(attributes)`

`static toDatabase(attributes: Row): Row`

Casts `attributes` to their storable primitives (via `castSet`) for a write.
Rarely called directly — `create`/`save` use it internally.

```ts
const storable = Post.toDatabase({ published: true }); // { published: 1 }
```

#### `Model.with(...names)` · `Model.withCount(...names)`

Start a [`ModelQuery`](#modelquery) that eager-loads the named relations (dotted
paths nest: `"posts.comments"`) or counts them into `<relation>_count`.

#### `Model.has(name)` · `Model.whereHas(name, constrain?)` · `Model.doesntHave(name, constrain?)`

Start a `ModelQuery` filtered by relationship existence — has at least one
related row, has one matching `constrain(query)`, or has none. `constrain`
receives the related-table query builder.

#### `Model.newQuery()`

`static newQuery(): ModelQuery<T>`

The model-aware query behind the sugar above — hydrates rows to models and adds
`with`/`withCount`/`whereHas`.

#### `Model.addGlobalScope(name, scope)`

`static addGlobalScope(name: string, scope: (query: QueryBuilder) => void): void`

Register a constraint applied to every query the model builds. Inherited by
subclasses; a subclass re-using a name overrides it.

#### `Model.withTrashed()` · `Model.onlyTrashed()` · `Model.withoutGlobalScope(...names)` · `Model.withoutGlobalScopes()`

Escape hatches returning a `QueryBuilder`: include (or only) soft-deleted rows,
or drop named / all global scopes. Deliberately explicit so an unscoped query is
greppable at audit time.

### `Model` — lifecycle events

Register per-class hooks (keyed by the exact class). The `*ing` events are
cancelable — a hook returning `false` aborts the operation.

#### `Model.creating` · `created` · `updating` · `updated` · `saving` · `saved` · `deleting` · `deleted` · `restoring` · `restored` · `retrieved`

`static <event>(hook: (model: T) => void | boolean | Promise<void | boolean>): void`

Add a hook for that lifecycle event. `create()` fires `saving`→`creating`→write→
`created`→`saved`; a save that updates fires the `updating`/`updated` pair.

#### `Model.observe(observer)`

`static observe(observer: Partial<Record<ModelEvent, ModelHook<T>>>): void`

Attach an observer object — each method named after an event becomes a hook.

### `Model` — configuration statics

Set these on the subclass to configure it. All have defaults.

#### `static table`

`static table: string`

The table the model reads and writes. Required — defaults to `""`.

```ts
class User extends Model { static table = "users"; }
```

#### `static primaryKey`

`static primaryKey: string`

The primary-key column used by `find`, `save`, and `delete`. Defaults to `"id"`.

```ts
class Session extends Model { static table = "sessions"; static primaryKey = "token"; }
```

#### `static fillable`

`static fillable: string[]`

Allowlist of mass-assignable columns. Defaults to `[]` (meaning "not an
allowlist" — see `filterFillable`).

```ts
class Post extends Model { static table = "posts"; static fillable = ["title", "body"]; }
```

#### `static guarded`

`static guarded: string[]`

Denylist of columns that mass-assignment must never set. Ignored when `fillable`
is non-empty. Defaults to `[]`.

```ts
class Post extends Model { static table = "posts"; static guarded = ["is_admin"]; }
```

#### `static casts`

`static casts: Casts`

Maps columns to cast types so values round-trip as real JS types. Declare it
`as const` so the literals don't widen to `string`. Defaults to `{}`.

```ts
class Post extends Model {
  static table = "posts";
  static casts = { published: "boolean", meta: "json" } as const;
}
```

#### `static hidden` / `static visible` / `static appends`

`static hidden: string[]` · `static visible: string[]` · `static appends: string[]`

Shape `toJSON()`: `hidden` strips columns, `visible` is an allowlist that wins,
`appends` adds computed attributes (a getter or zero-arg method). All default `[]`.

#### `static softDeletes` / `static deletedAtColumn`

`static softDeletes: boolean` (default `false`) · `static deletedAtColumn: string`
(default `"deleted_at"`)

Turn on soft deletes: `delete()` sets the timestamp and a global scope hides
trashed rows.

### `Model` — instance methods

#### `new Model(attributes?)`

`constructor(attributes?: Row)`

Hydrates a model from a row. Assignment is unguarded (rows come from the
database) but every column named in `casts` is cast on the way in.

```ts
const draft = new User({ email: "new@x.com" });
```

**Notes:** hydration bypasses `fillable`/`guarded` — it's for trusted rows, not
request bodies. Use `create`/`fill` for untrusted input.

#### `save()`

`save(): Promise<this>`

Inserts when the primary key is absent, updates when it's present — one method
for both. Back-fills the primary key after an insert.

```ts
const u = new User({ email: "a@b.com" });
await u.save(); // INSERT; u.id now set
u.name = "Grace";
await u.save(); // UPDATE where id = u.id
```

**Notes:** writes every own column (cast to storable primitives); loaded
relations live off-instance and never leak in. An update with no changed columns
still issues the query.

#### `delete()`

`delete(): Promise<void>`

Deletes the row matching this model's primary key — or, with `static softDeletes`
on, sets `deleted_at` instead. Fires `deleting`/`deleted`.

```ts
await user.delete();
```

**Notes:** keys off the current `primaryKey` value. See `forceDelete`/`restore`
for the soft-delete variants.

#### `forceDelete()` · `restore()` · `trashed()`

`forceDelete(): Promise<void>` · `restore(): Promise<this>` · `trashed(): boolean`

For soft-deletable models: permanently remove the row, clear `deleted_at`
(fires `restoring`/`restored`), or test whether it's currently trashed.

#### `fill(attributes)`

`fill(attributes: Row): this`

Merges mass-assignable attributes into the model (filtered + cast), without
saving. Returns `this` for chaining.

```ts
user.fill(request.all()).save();
```

**Notes:** respects `fillable`/`guarded` — safe for request bodies. Doesn't touch
the database until you call `save()`.

#### `forceFill(attributes)`

`forceFill(attributes: Row): this`

Like `fill`, but bypasses mass-assignment guarding. Still casts.

```ts
user.forceFill({ is_admin: true }); // deliberate over-post
```

**Notes:** the explicit escape hatch — only use it with trusted data.

#### `toJSON()`

`toJSON(): Row`

Returns a plain object of the model's (cast) attributes plus any loaded
relations, nested models included. `JSON.stringify` and `json()` call it
automatically.

```ts
return json(user); // toJSON() runs under the hood
user.toJSON();     // { id, email, …, posts: [...] } if `posts` was loaded
```

**Notes:** only *loaded* relations appear — unloaded relationship methods are not
invoked. Relations serialize recursively via each nested model's `toJSON`.

#### `getRelation(name)`

`getRelation<T = unknown>(name: string): T | undefined`

Reads a relation previously loaded by `Model.load` (or `setRelation`). Returns
`undefined` if it was never loaded.

```ts
const posts = users[0].getRelation<Post[]>("posts");
```

**Notes:** does not trigger a query — it only reads what's already cached. Awaiting
the relationship method (`await user.posts()`) is the lazy alternative.

#### `setRelation(name, value)`

`setRelation(name: string, value: unknown): this`

Stores a relation result under `name` (what eager loading uses under the hood).
Returns `this`.

```ts
user.setRelation("posts", await user.posts());
```

**Notes:** the store is keyed off the instance (a `WeakMap`), so it never leaks
into `save()`; `toJSON()` picks it up.

#### `hasMany(related, foreignKey?, localKey?)`

`hasMany<T extends Model>(related: ModelClass<T>, foreignKey?: string, localKey?: string): HasMany<T>`

Declares a one-to-many: this model has many `related` rows joined by a foreign
key on the related table. Call it from a relationship method.

```ts
posts() { return this.hasMany(Post); }                 // posts.user_id = users.id
authored() { return this.hasMany(Post, "authored_by", "id"); }
```

**Notes:** `foreignKey` defaults to `<thismodel>_<primaryKey>` (e.g. `user_id`);
`localKey` defaults to this model's primary key.

#### `hasOne(related, foreignKey?, localKey?)`

`hasOne<T extends Model>(related: ModelClass<T>, foreignKey?: string, localKey?: string): HasOne<T>`

Declares a one-to-one, same key conventions as `hasMany`.

```ts
profile() { return this.hasOne(Profile); }             // profiles.user_id = users.id
```

**Notes:** resolves to a single model or `null` (the first matching row).

#### `belongsTo(related, foreignKey?, ownerKey?)`

`belongsTo<T extends Model>(related: ModelClass<T>, foreignKey?: string, ownerKey?: string): BelongsTo<T>`

Declares the inverse: this model carries the foreign key pointing at `related`.

```ts
author() { return this.belongsTo(User); }              // posts.user_id -> users.id
owner()  { return this.belongsTo(User, "owner_id", "id"); }
```

**Notes:** `foreignKey` defaults to `<related>_<related.primaryKey>` (a column on
*this* table); `ownerKey` defaults to the related model's primary key. Resolves to
`null` when the foreign key is null.

#### `belongsToMany(related, pivotTable?, foreignPivotKey?, relatedPivotKey?, parentKey?, relatedKey?)`

`belongsToMany<T extends Model>(related: ModelClass<T>, pivotTable?: string, foreignPivotKey?: string, relatedPivotKey?: string, parentKey?: string, relatedKey?: string): BelongsToMany<T>`

Declares a many-to-many through a pivot table.

```ts
roles() { return this.belongsToMany(Role); }           // role_user pivot
roles() { return this.belongsToMany(Role, "user_roles", "user_id", "role_id"); }
```

**Notes:** `pivotTable` defaults to the two model names lowercased, sorted, and
joined with `_` (User + Role → `role_user`). The pivot keys default to
`<model>_<primaryKey>`. Reads as two `whereIn` queries (no JOIN), so it stays
edge-safe.

#### `morphMany(related, name, localKey?)` · `morphOne(related, name, localKey?)`

`morphMany<T>(related: ModelClass<T>, name: string, localKey?: string): MorphMany<T>`

The parent side of a polymorphic relation. Related rows carry `<name>_id` +
`<name>_type` (the type stored is this model's class name). `MorphMany` also has
`.create(attributes)`, which fills the morph keys.

```ts
comments() { return this.morphMany(Comment, "commentable"); }
```

#### `morphTo(name, idColumn?, typeColumn?)`

`morphTo(name: string, idColumn?: string, typeColumn?: string): MorphTo`

The owning side — resolves the parent from the stored `<name>_type` (via
[`registerMorphType`](#registermorphtypetype-model)) and `<name>_id`. Awaitable;
returns the parent model or `null`.

```ts
commentable() { return this.morphTo("commentable"); }
```

#### `registerMorphType(type, model)`

`registerMorphType(type: string, related: ModelClass<Model>): void`

Register a model under a morph-type string (usually its class name) so `morphTo`
can resolve it. Call once at boot for each owner type.

### `ModelQuery`

The model-aware builder returned by `Model.query()`, `Model.newQuery()`, and the
`with`/`whereHas`/`withCount` shortcuts. It proxies the query-builder constraint
methods (`where`, `orderBy`, `limit`, …) and hydrates results to models, adding:

- `with(...names)` — eager-load relations; dotted paths nest (`"posts.comments"`).
- `withCount(...names)` — add `<relation>_count` to each result.
- `has(name)` / `whereHas(name, constrain?)` / `doesntHave(name, constrain?)` —
  filter by relationship existence.
- Terminals `get()`, `first()`, `count()`, `exists()`, `paginate(page?, perPage?)`.

Existence filters and counts use the same driver-agnostic two-query strategy as
the relations (no JOIN). `toBase()` returns the underlying `QueryBuilder`.

### Relations

You never `new` these — a relationship method (`user.posts()`) returns one. Each
is **awaitable**: `await`ing it runs the query and resolves to the result. All
four share the `Relation` base contract (`query`, `get`, `eager`, `then`);
`BelongsToMany` adds pivot writes.

#### `Relation` (abstract base)

`abstract class Relation<TRelated extends Model, TResult> implements PromiseLike<TResult>`

The shared base. Because it's `PromiseLike`, a relation resolves through `await`
or `.then()` without calling `get()` explicitly.

```ts
const posts = await user.posts();          // then() → get()
const post = await user.posts().get();     // same thing, explicit
```

##### `query()`

`query(): QueryBuilder`

Returns the underlying query builder with the relationship constraint applied —
constrain, sort, or paginate before fetching.

```ts
const recent = await user.posts().query().orderBy("created_at", "desc").limit(5).get();
```

**Notes:** for `belongsToMany`, `query()` is the related-table builder *without*
the pivot filter — prefer `get()`/`await` for the full pivot-aware read.

##### `get()`

`get(): Promise<TResult>`

Runs the relationship and returns its result — the type depends on the subclass
(see below).

##### `eager(models, name)`

`eager(models: Model[], name: string): Promise<void>`

Batch-loads this relationship onto many parents and stores each result via
`setRelation`. Called by `Model.load` — you rarely call it directly.

##### `then(onFulfilled?, onRejected?)`

`then<R1, R2>(onFulfilled?, onRejected?): PromiseLike<R1 | R2>`

The `PromiseLike` hook that makes a relation awaitable; it delegates to `get()`.

#### `HasMany.get()`

`get(): Promise<T[]>`

Returns all related rows as hydrated models (empty array when none).

```ts
const posts: Post[] = await user.posts();
```

#### `HasOne.get()`

`get(): Promise<T | null>`

Returns the single related model, or `null`.

```ts
const profile = await user.profile(); // Profile | null
```

#### `BelongsTo.get()`

`get(): Promise<T | null>`

Returns the owner model, or `null` when this model's foreign key is null.

```ts
const author = await post.author(); // User | null
```

#### `BelongsToMany.get()`

`get(): Promise<T[]>`

Reads the pivot rows, then the related rows they point at, as hydrated models.

```ts
const roles: Role[] = await user.roles();
```

**Notes:** related ids are de-duplicated, so a row linked twice through the pivot
appears once.

#### `BelongsToMany.attach(id, extra?)`

`attach(id: unknown, extra?: Row): Promise<void>`

Inserts one pivot row linking the parent to `id`, plus any `extra` pivot columns.

```ts
await user.roles().attach(roleId);
await user.roles().attach(roleId, { assigned_at: now });
```

**Notes:** no uniqueness check — attaching the same id twice inserts two pivot
rows unless the table constrains it.

#### `BelongsToMany.detach(id?)`

`detach(id?: unknown): Promise<void>`

Removes the pivot row for `id`, or **all** the parent's pivot rows when called
with no argument.

```ts
await user.roles().detach(roleId); // one link
await user.roles().detach();       // every link for this user
```

#### `BelongsToMany.sync(ids)`

`sync(ids: unknown[]): Promise<void>`

Makes the pivot contain exactly `ids` — detaches everything, then attaches each.

```ts
await user.roles().sync([1, 2, 3]);
```

**Notes:** not diff-based — it detaches all then re-attaches, so passing `[]`
clears every link. Runs one delete plus one insert per id (not a transaction).

### Interfaces & types

#### `CastType`

```ts
type CastType =
  | "int" | "integer" | "float" | "number"
  | "boolean" | "bool" | "string"
  | "json" | "array" | "date";
```

The supported cast kinds — the values in a `casts` map. Aliases pair up
(`int`/`integer`, `float`/`number`, `boolean`/`bool`, `json`/`array`).

```ts
const kind: CastType = "boolean";
```

#### `Casts`

`type Casts = Record<string, CastType>`

A column-to-cast-type map — the shape of `static casts`. Declare literal maps
`as const` so the string values don't widen past `CastType`.

```ts
const casts: Casts = { published: "boolean", meta: "json" };
```

### Casting internals

`castGet`, `castSet`, and `applyCasts` (in `src/core/casts.ts`) are the functions
that power casting — `castGet` maps storage → JS, `castSet` maps JS → storage, and
`applyCasts` runs one of them over the keys named in a `Casts` map. They're
internal plumbing: the `Model` uses them for you and they aren't re-exported from
`@shaferllc/keel/core`, so declaring `static casts` is all you need.
