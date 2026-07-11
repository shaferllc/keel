# Transformers

A model knows the database; a **transformer** knows the API. It's the
presentation layer between the two — subclass `Transformer`, define one
`transform()` that maps a value to the exact shape you expose, and get
`item` / `collection` / `document` for free. No columns leak by accident, no
relation triggers a surprise query, and the same shape renders everywhere.
Edge-safe, like everything under it — a transformer leans on nothing but the
value you hand it.

## Defining a transformer

Subclass `Transformer<T>` and implement `transform`. The generic is the type you
map *from* (often a model); the return is a plain, JSON-ready object:

```ts
import { Transformer, type Attributes } from "@shaferllc/keel/core";
import { User } from "../app/Models/User.js";

export class UserTransformer extends Transformer<User> {
  transform(user: User): Attributes {
    return {
      id: user.id,
      name: user.name,
      joined: user.created_at,
    };
  }
}
```

Generate one with `keel make:transformer User` (→
`app/Transformers/UserTransformer.ts`). Pass `--model Account` when the class name
doesn't match the value it maps.

## Transforming

Three methods cover every case — one, many, or a full response document:

```ts
import { json } from "@shaferllc/keel/core";

const users = new UserTransformer();

json(users.item(user));        // one   → { id, name, joined } | null
json(users.collection(list));  // many  → [{ … }, { … }]
json(users.document(list, {    // wrapped, with meta
  meta: { total: list.length },
}));                           // → { data: [{ … }], total }
```

`item` returns `null` for a nullish value, so a not-found lookup passes straight
through. `collection` maps each value through `transform`. `document` is what you
usually hand back from a controller — it wraps the payload under a key (`data` by
default) and merges any top-level `meta` (pagination, counts, links) beside it.

## Conditional fields

`when` includes a key only when a condition holds — and *removes the key entirely*
otherwise, so no `null` leaks into the payload:

```ts
transform(user: User): Attributes {
  return {
    id: user.id,
    name: user.name,
    email: this.when(String(user.id) === this.viewerId, user.email), // only your own email
  };
}
```

For someone else's user, the response is simply `{ id, name }` — the `email` key
is gone, not `null`. Pass a third argument to substitute a fallback instead of
omitting, and pass a **thunk** to defer an expensive value until the condition is
true:

```ts
token: this.when(fresh, () => mintToken(user), null),  // null when not fresh
```

To gate *several* keys at once, `mergeWhen` returns an object to spread — `{}`
when the condition is false, so nothing is added:

```ts
return {
  id: user.id,
  ...this.mergeWhen(user.admin, { role: user.role, permissions: user.permissions }),
};
```

Transformers pass the current viewer (or any context) through the constructor —
they're plain instances:

```ts
export class UserTransformer extends Transformer<User> {
  constructor(private viewerId: string | null) {
    super();
  }
  // …use this.viewerId in transform()
}

json(new UserTransformer(auth().id()).collection(users));
```

## Nesting & relations

Embed one transformer inside another by calling it inline — the seam composes:

```ts
transform(post: Post): Attributes {
  return {
    id: post.id,
    title: post.title,
    author: new UserTransformer(this.viewerId).item(post.author),
  };
}
```

But for a [model](./models.md) relation, reach for `whenLoaded` — it includes the
relation **only if it was eager-loaded**, so a transformer never fires a query
behind your back:

```ts
transform(user: User): Attributes {
  return {
    id: user.id,
    name: user.name,
    posts: this.whenLoaded(user, "posts", new PostTransformer()),
  };
}
```

`whenLoaded` reads the relation off the model (via the model's `getRelation`, set
by [`Model.load`](./models.md)), and, if present, runs it through the transformer
you pass — a `collection` for an array relation, an `item` for a single one. If
the relation wasn't loaded, the key is omitted. Pass a plain function instead of a
transformer to map it yourself:

```ts
roles: this.whenLoaded(user, "roles", (roles) => roles.map((r) => r.name)),
```

So the caller controls depth by choosing what to load:

```ts
const users = await User.all();
await User.load(users, "posts");                 // eager-load first
json(new UserTransformer().collection(users));   // …then posts appear
```

Without the `load`, the same transformer simply omits `posts` — no N+1, no
surprise. See [Models](./models.md#eager-loading) for eager loading.

## Response documents

`document` builds the envelope most JSON APIs return — a wrapped payload plus
top-level metadata:

```ts
const page = await User.all();
return json(
  new UserTransformer().document(page, {
    meta: { total: page.length, page: 1 },
  }),
);
// { "data": [ … ], "total": 42, "page": 1 }
```

Change the wrapper per class by setting `wrapKey`, or per call with the `key`
option; set `key: null` to merge a single object's fields to the top level (meta
included):

```ts
class UserTransformer extends Transformer<User> {
  wrapKey = "user"; // → { user: { … } }
}

new UserTransformer().document(user, { key: null, meta: { fetchedAt } });
// { id, name, …, fetchedAt }
```

`item` and `collection` return the **bare** shape (no wrapper) so they compose
cleanly when nested; `document` is the one that wraps. Reach for `document` at the
edge of a response and `item`/`collection` everywhere inside.

## In a controller

The whole point is a controller that reads clean:

```ts
export class UserController {
  async show(c: Ctx) {
    const user = await User.findOrFail(c.req.param("id"));
    return c.json(new UserTransformer(auth().id()).item(user));
  }

  async index(c: Ctx) {
    const users = await User.all();
    await User.load(users, "posts");
    return c.json(new UserTransformer(auth().id()).document(users));
  }
}
```

## Related

Transformers sit downstream of [Models](./models.md) — they shape what a model
exposes without the model knowing about the API. They pair with the
[request/response](./request-response.md) helpers (`json`) at the edge, and with
[authentication](./authentication.md) when a field depends on the viewer.

---

## API reference

### `Transformer<T>`

The abstract base. Subclass it, set the generic to the value you map *from*, and
implement `transform`. Instances are plain — pass request context (a viewer id, a
locale) through the constructor.

```ts
class UserTransformer extends Transformer<User> {
  transform(user: User): Attributes {
    return { id: user.id, name: user.name };
  }
}
```

#### `transform(item)`

`abstract transform(item: T): Attributes`

Maps one value to its API shape — the only method a subclass must implement.
Returns a plain object; use the helpers below to add fields conditionally.

```ts
transform(user: User): Attributes {
  return { id: user.id, name: user.name };
}
```

**Notes:** called once per value by `item`/`collection`. Its result is *pruned*
(any `when`/`whenLoaded`-omitted keys are stripped, recursively) before you see
it, so an omitted key is truly absent — not `undefined`.

#### `item(value)`

`item(value: T | null | undefined): Attributes | null`

Transforms a single value. A nullish value passes straight through as `null`.

```ts
new UserTransformer().item(user);   // { id, name }
new UserTransformer().item(null);   // null
```

**Notes:** returns the **bare** shape (no `wrapKey` wrapper) — wrap with
`document` when returning a response. `null` in, `null` out, so a `findOrNull`
result needs no guard.

#### `collection(values)`

`collection(values: T[]): Attributes[]`

Transforms an array, each value through `transform`.

```ts
new UserTransformer().collection(await User.all());
```

**Notes:** returns a bare array (no wrapper). Empty in, empty out. Combine with
`Model.load` beforehand so any `whenLoaded` relations are present.

#### `document(value, options?)`

`document(value: T | T[] | null | undefined, options?: DocumentOptions): Attributes`

Builds a response document: the transformed payload wrapped under a key, with
optional top-level `meta`. An array becomes a list; anything else a single object.

```ts
new UserTransformer().document(users, { meta: { total: users.length } });
// { data: [ … ], total }
```

**Notes:** the wrapper key is `options.key` if given, else the instance `wrapKey`
(default `"data"`). With `key: null` a single object's fields merge to the top
level alongside `meta`; an array with no key still gets a `data` home (meta can't
share a level with a bare array).

#### `wrapKey`

`wrapKey: string | null`

The key `document` wraps under by default. Override per subclass; `null` disables
wrapping.

```ts
class UserTransformer extends Transformer<User> {
  wrapKey = "user";
}
```

**Notes:** defaults to `"data"`. Only consulted by `document` — `item` and
`collection` never wrap.

#### `when(condition, value, fallback?)`

`protected when<V>(condition: unknown, value: V | (() => V), fallback?: V): V`

Include `value` when `condition` is truthy; otherwise **omit the key** — or use
`fallback` if you pass one. `value` may be a thunk, evaluated only when the
condition holds.

```ts
email: this.when(isSelf, user.email),          // key vanishes for others
token: this.when(fresh, () => mint(), null),   // null fallback, lazy value
```

**Notes:** a helper for use inside `transform`. With no `fallback`, a false
condition removes the key entirely (via a sentinel that pruning strips) rather
than emitting `null`. The thunk form defers work you don't want to pay for when
the field is hidden.

#### `mergeWhen(condition, values)`

`protected mergeWhen(condition: unknown, values: Attributes | (() => Attributes)): Attributes`

The merge counterpart to `when` — returns `values` (spread several keys in) when
`condition` holds, or `{}` when it doesn't.

```ts
return { id: u.id, ...this.mergeWhen(u.admin, { role: u.role, flags: u.flags }) };
```

**Notes:** meant to be spread (`...`). `values` may be a thunk, deferred until the
condition is true. Use it when a *group* of fields appears together.

#### `whenLoaded(model, name, map?)`

`protected whenLoaded<V>(model: unknown, name: string, map?: Transformer | ((value) => unknown)): V`

Include a relation only if it was already loaded — **never fires a query**. Reads
the relation off the model and, if present, runs it through `map` (a transformer
or a function). Omits the key when it isn't loaded.

```ts
posts: this.whenLoaded(user, "posts", new PostTransformer()),
roles: this.whenLoaded(user, "roles", (rs) => rs.map((r) => r.name)),
```

**Notes:** resolves the relation via the model's `getRelation` (set by
`Model.load`) or a plain loaded property — a relation *method* is never mistaken
for a value. With a `Transformer`, an array relation goes through `collection` and
a single one through `item`. With no `map`, the raw loaded value is used.

### `Attributes`

```ts
type Attributes = Record<string, unknown>;
```

The shape a transformer produces — a plain, JSON-ready object. `transform` returns
one; so do `item` and `document`.

### `DocumentOptions`

```ts
interface DocumentOptions {
  key?: string | null;   // wrap under this key; null disables. Defaults to wrapKey.
  meta?: Attributes;     // top-level fields merged beside the payload.
}
```

Controls `document`'s envelope. `key` overrides the instance `wrapKey` for one
call; `meta` supplies pagination, counts, or links at the top level.

```ts
new UserTransformer().document(users, { key: "records", meta: { total: 42 } });
// { records: [ … ], total: 42 }
```
