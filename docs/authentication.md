# Authentication

Session-based auth built on the pieces you already have: [sessions](./sessions.md)
hold the login, [hashing](./hashing.md) checks passwords. `auth()` ties them
together.

Requires [`sessionMiddleware()`](./sessions.md) in your HTTP kernel — every
`auth()` call reaches through the session, so without the middleware the first
call throws `Session is not available…`.

## Tell Keel how to load a user

Register a **user provider** once (in a service provider) — a function that
returns a user for an id. Keel stays database-agnostic, so this is wherever your
users live:

```ts
import { setUserProvider } from "@shaferllc/keel/core";

setUserProvider((id) => db.users.find(id));
```

The id handed to your provider is always a **string** — `login()` normalizes
whatever you pass (number or string) with `String(id)` before stashing it. If
your ids are numeric, coerce inside the provider (`db.users.find(Number(id))`).

## Logging in

Verify the password yourself with `hash`, then `login()` the user's id:

```ts
import { auth, hash, response } from "@shaferllc/keel/core";

async login() {
  const { email, password } = await request.only(["email", "password"]);
  const user = await db.users.findByEmail(email);

  if (!user || !(await hash.verify(user.password, password))) {
    return response.abort("Invalid credentials", 401);
  }

  auth().login(user.id);
  return response.redirect("/dashboard");
}
```

`login()` only writes the id to the session — it does no lookup and no password
check. Verifying credentials is your job (above); `login()` is the "trust this id
from now on" step.

## Reading the current user

```ts
auth().check();        // is someone logged in?
auth().guest();        // …or not?
auth().id();           // the user id (string), or null
await auth().user();   // the full user (via your provider), or null
```

`user()` reads the id from the session and runs it back through your provider on
every call — there's no request-level cache, so if you need it twice in one
handler, hold onto the result. Type the row it returns with the generic:

```ts
type User = { id: number; email: string };

const user = await auth().user<User>(); // User | null
```

`user()` returns `null` when nobody is logged in. But if someone *is* logged in
and you never called `setUserProvider`, it throws — Keel has no way to turn the
id back into a user:

```
Error: No user provider. Call setUserProvider((id) => findUser(id)).
```

## Logging out

```ts
auth().logout();
return response.redirect("/");
```

`logout()` forgets the id from the session; it doesn't destroy the whole session,
so anything else you flashed or stored survives. Clear the session yourself if
you want a clean slate on sign-out.

## Protecting routes

`authGuard()` rejects unauthenticated requests. Register it as
[named middleware](./middleware.md) and apply it wherever you need:

```ts
import { authGuard } from "@shaferllc/keel/core";

router.named({ auth: authGuard({ redirectTo: "/login" }) });

router.get("/dashboard", [DashboardController, "index"]).use("auth");
router.group(() => { /* … */ }).use("auth");
```

Without `redirectTo`, the guard returns `401 Unauthenticated` (ideal for APIs):

```ts
router.named({ auth: authGuard() }); // 401 JSON on failure, no redirect
```

The guard only checks that *someone* is logged in — it runs no provider lookup
and loads no user. It gates on `guest()`, so it's cheap; load the user inside the
handler with `auth().user()` when you actually need it.

## Registration

Registration is the same flow in reverse — hash the password on the way in:

```ts
const user = await db.users.create({
  email,
  password: await hash.make(password),
});
auth().login(user.id);
```

## Working with `Auth` directly

`auth()` is a thin accessor — it returns a fresh, stateless `Auth` bound to the
current request's session. You can construct one yourself if you prefer; it reads
the same session, so the two are interchangeable:

```ts
import { Auth } from "@shaferllc/keel/core";

if (new Auth().check()) { /* … */ }
```

There's nothing to share between instances — all state lives in the session — so
`auth()` and `new Auth()` behave identically.

---

## API reference

### `auth()`

`auth(): Auth`

Returns an `Auth` accessor bound to the current request's session.

```ts
import { auth } from "@shaferllc/keel/core";

auth().login(userId);
await auth().user();
```

**Notes:** constructs a fresh `Auth` each call — it's stateless, so there's no
cost to calling it repeatedly. Every method underneath reaches through
`session()`, which throws if `sessionMiddleware()` isn't installed.

### `setUserProvider(fn)`

`setUserProvider(fn: UserProvider): void`

Registers the function Keel uses to turn a stored id back into a user.

```ts
import { setUserProvider } from "@shaferllc/keel/core";

setUserProvider((id) => db.users.find(id));
```

**Notes:** global — the last call wins. Register it once in a service provider.
Until it's set, `auth().user()` throws for a logged-in request (but still returns
`null` for a guest).

### `authGuard(options?)`

`authGuard(options?: { redirectTo?: string }): MiddlewareHandler`

Builds a middleware that blocks unauthenticated requests.

```ts
import { authGuard } from "@shaferllc/keel/core";

router.named({
  auth: authGuard({ redirectTo: "/login" }),
  api: authGuard(), // 401 instead
});
```

**Notes:** with `redirectTo`, guests get a redirect; without it, a
`401 { error: "Unauthenticated", status: 401 }` JSON response. Authenticated
requests pass straight through to the next handler. The check is `guest()` only —
no user is loaded.

### `Auth`

The accessor returned by `auth()`. Stateless — all its state lives in the
session — so you rarely construct it directly, though `new Auth()` works and is
equivalent to `auth()`.

#### `login(id)`

`login(id: string | number): void`

Marks the given id as the authenticated user by storing it in the session.

```ts
auth().login(user.id);
```

**Notes:** does no lookup or password check — verify credentials before calling.
The id is coerced with `String(id)`, so `id()` and your provider always receive a
string.

#### `logout()`

`logout(): void`

Forgets the authenticated id from the session.

```ts
auth().logout();
```

**Notes:** only removes the auth key — other session data (flashes, cart, etc.)
survives. Call `session().clear()` yourself for a full reset.

#### `id()`

`id(): string | null`

The authenticated user's id, or `null` if nobody is logged in.

```ts
const uid = auth().id(); // "42" | null
```

**Notes:** always a string (see `login`). Returns `null`, not `undefined`, for a
guest.

#### `check()`

`check(): boolean`

`true` when a user is authenticated.

```ts
if (auth().check()) { /* logged in */ }
```

**Notes:** a pure `id() != null` test — reads the session, runs no provider.

#### `guest()`

`guest(): boolean`

`true` when the request is unauthenticated — the inverse of `check()`.

```ts
if (auth().guest()) return response.redirect("/login");
```

#### `user(...)`

`user<User = unknown>(): Promise<User | null>`

Loads the full authenticated user by running the session id through the
registered provider.

```ts
type User = { id: number; email: string };
const user = await auth().user<User>(); // User | null
```

**Notes:** returns `null` when nobody is logged in. Throws
`No user provider…` if a user *is* logged in but `setUserProvider` was never
called. No caching — each call re-invokes the provider. The generic only types
the result; it does not validate the row's shape at runtime.

### Interfaces & types

#### `UserProvider`

```ts
type UserProvider = (id: string) => unknown | Promise<unknown>;
```

The seam between Keel and your user store. Implement it once and register it with
`setUserProvider` — Keel calls it with the string id from the session whenever
`auth().user()` runs, and treats the return value as the authenticated user.

```ts
import { setUserProvider, type UserProvider } from "@shaferllc/keel/core";

const provider: UserProvider = async (id) => {
  // `id` is always a string; coerce if your keys are numeric
  return db.users.find(Number(id));
};

setUserProvider(provider);
```

**Notes:** may be sync or async — `user()` awaits it either way. Return the user
object (any shape) when found, or a nullish value when not; that value flows back
out of `auth().user()`.
