# Sessions

Keel ships a cookie-backed session store. There's no external service to run, so
it works the same on Node and on the edge. Session data lives in an HTTP-only
cookie: the middleware reads it before your handler runs and writes it back
afterward.

> **The cookie is base64-encoded, not signed or encrypted.** Anyone can decode
> and forge it. Keep secrets out of the session (store an id, not a password
> hash or a role you trust for authorization on its own), and set
> `cookie: { secure: true }` in production so it's only sent over HTTPS.

## Enable it

Add the middleware to your HTTP kernel:

```ts
import { HttpKernel, sessionMiddleware } from "@shaferllc/keel/core";

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(sessionMiddleware());
    // options: sessionMiddleware({ cookieName: "sid", cookie: { secure: true } })
  }
}
```

The cookie is named `keel_session` by default and is written `httpOnly`,
`path: "/"`, `sameSite: "Lax"`. Anything you pass in `cookie` is merged over
those defaults, so `cookie: { secure: true }` adds the `Secure` flag while
keeping the rest.

## Use it

Reach the session anywhere with `session()`:

```ts
import { session } from "@shaferllc/keel/core";

session().put("userId", user.id);
const id = session().get("userId");
const id2 = session().get("userId", null); // with a fallback

session().has("userId");
session().forget("userId");
session().pull("cart");      // read and remove
session().increment("visits");
session().clear();
session().all();
```

`session()` returns a fresh `Session` wrapper each call, but every wrapper points
at the *same* underlying data object stashed on the request context — so writes
made through one call are visible through the next. There's no need to hold onto
the instance:

```ts
session().put("step", 1);
session().get("step"); // 1 — same request, same data
```

Calling `session()` without `sessionMiddleware()` installed throws
`Session is not available. Add sessionMiddleware() to your HTTP kernel.` — the
guard is there so a missing middleware fails loudly instead of silently dropping
writes.

## Flash messages

Flash data survives exactly one request — perfect for post-redirect messages:

```ts
// during a request that redirects
session().flash("status", "Profile saved!");
return redirect("/profile");

// on the next request
session().flashed("status");     // "Profile saved!"
session().flashed("status");     // still there this request…
// …gone on the request after
```

Flash and the values you `put` live in separate compartments. `flash(key, …)`
writes to a pending-flash bucket; `flashed(key)` reads the bucket that was
flashed on the *previous* request. So within the request that calls `flash`, a
`flashed` for the same key won't see it yet — it lands on the next request:

```ts
session().flash("status", "Saved!");
session().flashed("status"); // undefined — not flashed until next request
session().get("status");     // undefined — flash isn't a normal key
```

`all()` returns only your own keys — the internal flash and "old flash" buckets
are filtered out, so they never leak into a template's session dump.

## Counters

`increment` and `decrement` treat a missing key as `0` and step by `1` (or any
amount you pass):

```ts
session().increment("visits");      // 0 -> 1
session().increment("credits", 10); // += 10
session().decrement("credits", 3);  // -= 3
```

Both coerce the stored value to a number, so seeding a counter with a non-numeric
value will produce `NaN` — keep counters numeric.

## How it works

`sessionMiddleware()` reads the session cookie before your handler runs and
writes it back afterward. Data is JSON, base64-encoded into the cookie. On each
request it rotates flash: last request's pending flash becomes this request's
"old" (what `flashed` reads), and a fresh empty flash bucket starts. After your
handler returns, the "old" bucket is dropped and the cookie is rewritten — so a
value only ever survives one hop.

Because it's cookie-backed there's a ~4KB size budget — keep sessions small (an
id, a few flags), not whole objects. For larger sessions, swap in your own
middleware that persists to a store and stashes the data on the context under the
`"session"` key the same way.

> **Latin1 only.** Values are serialized with `btoa`, which throws on characters
> outside the Latin1 range. A flash message or stored string containing an emoji
> or many non-Latin scripts will throw `InvalidCharacterError` when the cookie is
> written. Keep session values ASCII/Latin1, or encode them yourself first.

## Related

Sessions underpin [authentication](./authentication.md) — the auth layer stores
the logged-in user's id in the session. Install `sessionMiddleware()` before any
middleware that reads the session.

---

## API reference

### `session()`

`session(): Session`

Returns the current request's `Session`, wrapping the data on the request
context.

```ts
session().put("userId", 1);
```

**Notes:** throws `Session is not available…` if `sessionMiddleware()` isn't
installed (no `"session"` on the context). Returns a new wrapper each call, but
all wrappers share the same underlying data for the request, so writes persist
across calls.

### `sessionMiddleware(options?)`

`sessionMiddleware(options?: SessionOptions): MiddlewareHandler`

Builds the middleware that loads the session from its cookie before the request
and writes it back after. Register it in your HTTP kernel.

```ts
this.use(sessionMiddleware({ cookieName: "sid", cookie: { secure: true } }));
```

**Notes:** cookie name defaults to `"keel_session"`. A missing or malformed
cookie starts an empty session (parse errors are swallowed — "tampered/expired,
start fresh"). The write applies `httpOnly`, `path: "/"`, `sameSite: "Lax"`,
merged with (and overridable by) `options.cookie`. Rotates flash on every
request.

### `Session`

The wrapper `session()` returns. You don't construct it directly in app code
(the middleware and `session()` build it), though its constructor takes the raw
data object. Mutating methods return `this`, so they chain.

#### `all()`

`all(): SessionData`

Returns every key you've stored, excluding the internal flash/old-flash buckets.

```ts
const data = session().all(); // Record<string, unknown>
```

**Notes:** `SessionData` is `Record<string, unknown>`. A shallow copy of the
public keys — mutating the result doesn't write back to the session.

#### `get(key, fallback?)`

`get<T = unknown>(key: string, fallback?: T): T`

Reads a value, returning `fallback` when the key is absent.

```ts
const id = session().get<number>("userId");
const theme = session().get("theme", "light");
```

**Notes:** presence is checked with `key in data`, so a key explicitly set to
`null` returns `null` (not the fallback). The `T` type parameter is an unchecked
cast — it doesn't validate the runtime value.

#### `put(key, value)`

`put(key: string, value: unknown): this`

Stores a value under `key`.

```ts
session().put("userId", user.id).put("theme", "dark");
```

**Notes:** chainable. Values must be JSON-serializable (they're `JSON.stringify`d
into the cookie) and Latin1 once stringified.

#### `set(key, value)`

`set(key: string, value: unknown): this`

Alias for `put`.

```ts
session().set("locale", "en");
```

#### `has(key)`

`has(key: string): boolean`

`true` when the key is present *and* non-null.

```ts
if (session().has("userId")) { /* logged in */ }
```

**Notes:** returns `false` for a key set to `null` or `undefined`, even though
`get` would still return that stored `null`.

#### `forget(key)`

`forget(key: string): this`

Deletes a key.

```ts
session().forget("userId");
```

#### `pull(key, fallback?)`

`pull<T = unknown>(key: string, fallback?: T): T`

Reads a value and removes it in one step (`get` + `forget`).

```ts
const cart = session().pull("cart", []);
```

**Notes:** returns `fallback` when absent, same rules as `get`. Useful for
one-shot values you don't want lingering.

#### `increment(key, by?)`

`increment(key: string, by = 1): this`

Adds `by` to a numeric value, treating a missing key as `0`.

```ts
session().increment("visits");
session().increment("credits", 25);
```

**Notes:** coerces the current value with `as number` — non-numeric stored values
yield `NaN`. Chainable.

#### `decrement(key, by?)`

`decrement(key: string, by = 1): this`

Subtracts `by` from a numeric value (`increment` by `-by`).

```ts
session().decrement("credits", 3);
```

#### `clear()`

`clear(): this`

Removes every key, including the flash buckets.

```ts
session().clear();
```

**Notes:** deletes all keys off the underlying data object, so it also wipes
pending and old flash. Use to reset on logout.

#### `flash(key, value)`

`flash(key: string, value: unknown): this`

Stores a value that survives only the *next* request.

```ts
session().flash("status", "Profile saved!");
```

**Notes:** writes to a separate flash bucket, not the normal keyspace — `get`
and `all` won't see it. Read it next request with `flashed`. Chainable.

#### `flashed(key, fallback?)`

`flashed<T = unknown>(key: string, fallback?: T): T`

Reads a value flashed on the *previous* request.

```ts
const status = session().flashed("status");
const msg = session().flashed("msg", "");
```

**Notes:** reads the "old" bucket the middleware rotated in at the start of the
request. A value flashed and read in the same request won't appear here (it's not
yet rotated). Returns `fallback` when absent.

### Interfaces & types

#### `SessionOptions`

```ts
interface SessionOptions {
  cookieName?: string;
  cookie?: CookieOptions; // hono's setCookie options (Parameters<typeof setCookie>[3])
}
```

Configures `sessionMiddleware()`. Use it to rename the cookie or set flags like
`secure`, `maxAge`, or `domain`.

```ts
sessionMiddleware({
  cookieName: "sid",
  cookie: { secure: true, maxAge: 60 * 60 * 24 },
});
```

**Notes:** `cookieName` defaults to `"keel_session"`. `cookie` is merged *over*
the middleware's defaults (`httpOnly`, `path: "/"`, `sameSite: "Lax"`), so you
can override any of them.
