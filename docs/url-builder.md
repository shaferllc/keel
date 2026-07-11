# URL Builder

Generate URLs from **named routes** so paths live in one place. Name a route,
then build its URL by name — with params and query strings — and never hardcode
a path again.

The URL builder lives on the `Router`. In an app you resolve it from the
container (`app.make(Router)`); the examples below assume a `router` in scope.

## Building URLs

```ts
router.get("/users/:id", [UserController, "show"]).name("users.show");

router.url("users.show", { id: 42 });
// "/users/42"

router.url("users.show", { id: 42 }, { qs: { tab: "posts", page: 2 } });
// "/users/42?tab=posts&page=2"
```

Params are matched by name against the `:param` segments in the route path, and
each value is `encodeURIComponent`-escaped, so slashes and spaces are safe:

```ts
router.get("/files/:name", [FileController]).name("files.show");
router.url("files.show", { name: "a/b c.txt" });
// "/files/a%2Fb%20c.txt"
```

Query values are coerced to strings (numbers become their decimal form), so you
can pass `{ page: 2 }` and get `page=2`. An empty `qs` (`{}`) adds no `?`.

### Optional params

A trailing `:param?` segment is dropped when you don't pass it:

```ts
router.get("/posts/:id?", [PostController, "show"]).name("posts.show");

router.url("posts.show", { id: 7 }); // "/posts/7"
router.url("posts.show", {});        // "/posts"  (optional segment stripped)
```

Any required `:param` you forget to supply is stripped too — so a missing param
silently produces a shorter path rather than throwing. Pass every required param.

### Errors

`url()` throws `No route named [name].` if no registered route carries that name.
Names come from `.name()` / `.as()`, so name a route before you build its URL.

```ts
router.url("nope"); // throws: No route named [nope].
```

## Signed URLs

A signed URL carries a tamper-proof signature — perfect for one-off links
(email confirmations, unsubscribe, downloads) where you want to trust the
parameters without a database lookup. Signing uses `config('app.key')`, so set
an `APP_KEY`:

```ts
// generate (async — uses Web Crypto, works on Node and the edge)
const url = await router.signedUrl("download", { id: 7 });
const expiring = await router.signedUrl("download", { id: 7 }, { expiresIn: 3600 });
```

`signedUrl` builds the URL exactly like `url()`, appends any `qs` you pass, adds
an `expires` timestamp when `expiresIn` is set, then HMAC-SHA256 signs the whole
path-plus-query with the app key and appends a `signature` parameter. The result
looks like:

```
/download/7?expires=1710000000&signature=8f3c…
```

Verify the incoming request in your handler or a middleware:

```ts
show() {
  if (!(await router.hasValidSignature())) {
    return response.abort("Invalid or expired link", 403);
  }
  // …trusted params
}
```

`hasValidSignature()` reads the current request, strips the `signature`
parameter, re-signs the remaining path and query with the app key, and compares.
It returns `false` if the signature is missing, the URL was tampered with, or an
`expires` timestamp has passed.

Both `signedUrl()` and `hasValidSignature()` throw
`Signed URLs require config('app.key').` when no app key is configured — set
`APP_KEY` before you use either.

## Parameter constraints & matchers

Route params can be constrained with a regex so a URL only matches when the
segment fits. A constraint is a `Matcher` — a `RegExp`, a raw source string, or
a `{ match: RegExp }` object — passed to `.where()`:

```ts
router.get("/users/:id", [UserController]).where("id", /\d+/);
router.get("/p/:slug", [PostController]).where("slug", { match: /[a-z0-9-]+/ });
```

The `matchers` export bundles the common patterns so you don't rewrite them:

```ts
import { matchers } from "@shaferllc/keel/core";

router.get("/users/:id", [UserController]).where("id", matchers.number());
router.get("/t/:id", [TeamController]).where("id", matchers.uuid());
router.get("/p/:slug", [PostController]).where("slug", matchers.slug());
router.get("/c/:code", [CodeController]).where("code", matchers.alpha());
```

The same helpers hang off the router instance as `router.matchers`, so you can
reach them without a separate import. `matchers` is not part of URL *generation*
— it shapes which URLs a route will *match* — but the two work together: build a
URL with `url()` and it will satisfy the constraint if your params are the right
shape.

## Notes

- Signatures cover the path **and** query string, so changing any parameter
  invalidates the link.
- The signing key must be stable and secret. Set `APP_KEY` to a long random
  value (and keep it out of source control).

---

## API reference

### Router (URL methods)

You get the `Router` from the container (`app.make(Router)`); in tests it's
constructed directly as `new Router(container)`. These three methods make up the
URL-building surface.

#### `url(name, params?, options?)`

`url(name: string, params?: Record<string, string | number>, options?: UrlOptions): string`

Builds the path for a named route, substituting `:params` and appending an
optional query string.

```ts
router.url("users.show", { id: 42 }, { qs: { tab: "posts" } });
// "/users/42?tab=posts"
```

**Notes:** `params` defaults to `{}`, `options` to `{}`. Values are
`encodeURIComponent`-escaped; query values are stringified. Optional (`:id?`) and
any unsupplied required params are stripped from the path. Throws
`No route named [name].` if the name is unknown. Each `:param` is replaced once,
so a param that appears twice in a single path only substitutes its first
occurrence — avoid repeating a param name in one route.

#### `signedUrl(name, params?, options?)`

`signedUrl(name: string, params?: Record<string, string | number>, options?: SignedUrlOptions): Promise<string>`

Like `url()`, but HMAC-SHA256 signs the path-plus-query with `config('app.key')`
and appends a `signature` parameter, yielding a tamper-proof link.

```ts
const link = await router.signedUrl("download", { id: 7 }, { expiresIn: 3600 });
```

**Notes:** async (Web Crypto — Node and edge). `expiresIn` is seconds from now;
it adds an `expires` unix-second timestamp that is covered by the signature.
Throws `Signed URLs require config('app.key').` if no app key is set. Reserve the
`signature` and `expires` query keys — passing them via `options.qs` collides
with the ones this method adds.

#### `hasValidSignature()`

`hasValidSignature(): Promise<boolean>`

Verifies the signature on the current request: re-signs the path and query
(minus `signature`) and checks it matches, honoring any `expires` timestamp.

```ts
if (!(await router.hasValidSignature())) {
  return response.abort("Invalid or expired link", 403);
}
```

**Notes:** reads the ambient request, so call it inside a handler/middleware.
Returns `false` when the `signature` param is absent, the recomputed HMAC
differs, or `expires` is in the past. Throws
`Signed URLs require config('app.key').` if no app key is set.

### `matchers`

An object of built-in parameter-constraint patterns. Each is a zero-arg function
returning a fresh `RegExp`, suitable as the `Matcher` argument to `.where()`.
Also exposed on the router as `router.matchers`.

#### `matchers.number()`

`number(): RegExp`

Matches one or more digits — `/\d+/`.

```ts
router.get("/users/:id", [UserController]).where("id", matchers.number());
```

#### `matchers.uuid()`

`uuid(): RegExp`

Matches a canonical 8-4-4-4-12 hex UUID (case-insensitive).

```ts
router.get("/t/:id", [TeamController]).where("id", matchers.uuid());
```

#### `matchers.slug()`

`slug(): RegExp`

Matches a lowercase slug — `[a-z0-9]+` groups joined by single hyphens
(`/[a-z0-9]+(?:-[a-z0-9]+)*/`).

```ts
router.get("/p/:slug", [PostController]).where("slug", matchers.slug());
```

#### `matchers.alpha()`

`alpha(): RegExp`

Matches one or more ASCII letters — `/[a-zA-Z]+/`.

```ts
router.get("/c/:code", [CodeController]).where("code", matchers.alpha());
```

### Interfaces & types

#### `UrlOptions`

```ts
interface UrlOptions {
  qs?: Record<string, string | number>;
}
```

The options bag for `url()`. `qs` becomes the query string; each value is
stringified. Use it to tack a query onto a generated URL.

```ts
const opts: UrlOptions = { qs: { page: 2, tab: "posts" } };
router.url("users.show", { id: 1 }, opts);
```

#### `SignedUrlOptions`

```ts
interface SignedUrlOptions extends UrlOptions {
  /** Expiry in seconds from now. */
  expiresIn?: number;
}
```

Extends `UrlOptions` with `expiresIn` for `signedUrl()`. With `expiresIn` set,
the signed link stops validating after that many seconds.

```ts
const opts: SignedUrlOptions = { qs: { plan: "pro" }, expiresIn: 3600 };
await router.signedUrl("download", { id: 7 }, opts);
```

#### `Matcher`

```ts
type Matcher = RegExp | string | { match: RegExp };
```

A route-parameter constraint accepted by `.where()`: a `RegExp`, a raw regex
*source* string, or a `{ match: RegExp }` wrapper. The `matchers` helpers return
the `RegExp` form.

```ts
const a: Matcher = /\d+/;
const b: Matcher = "[0-9]+";
const c: Matcher = { match: /[a-z-]+/ };
router.get("/x/:id", [XController]).where("id", a);
```
