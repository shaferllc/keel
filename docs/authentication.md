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

**Verify in constant time.** The snippet above skips the password check when no
user is found, so a missing account answers faster than a wrong password — a
timing signal that leaks which emails are registered. Compare against `hash.dummy`
(a valid hash that never matches) so both paths cost the same:

```ts
const user = await db.users.findByEmail(email);
const ok = await hash.verify(user?.password ?? hash.dummy, password);
if (ok && user) auth().login(user.id);   // `user &&` so the dummy never logs anyone in
```

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

## Token (API) authentication

Sessions ride on a cookie — great for a server-rendered app, awkward for an SPA,
a mobile client, or another service. For those, issue a **stateless bearer
token**: an HS256 JWT signed with `config('app.key')`, built on the Web Crypto
API so it works the same on Node and the edge (no `jsonwebtoken`, no native
bindings). This is the Cloudflare-Workers-friendly path — nothing to store
server-side.

Issue a token in your login handler instead of (or alongside) `auth().login()`:

```ts
import { jwt, hash, response } from "@shaferllc/keel/core";

async login() {
  const { email, password } = await request.only(["email", "password"]);
  const user = await db.users.findByEmail(email);
  if (!user || !(await hash.verify(user.password, password))) {
    return response.abort("Invalid credentials", 401);
  }

  const token = await jwt.sign({ sub: String(user.id) }, { expiresIn: "1h" });
  return response.json({ token });
}
```

Protect API routes with `bearerAuth()`. It reads `Authorization: Bearer <token>`,
verifies it, and makes the token's `sub` the authenticated id — so `auth()` works
downstream exactly as it does for sessions, provider lookup and all:

```ts
import { bearerAuth, auth } from "@shaferllc/keel/core";

router.get("/api/me", async () => response.json(await auth().user())).use(bearerAuth());
```

A missing or invalid token gets `401 Unauthenticated`. Pass `{ optional: true }`
to let the request through unauthenticated (`auth().check()` is then `false`). A
token verified this way takes precedence over any session cookie on the same
request, and — unlike sessions — needs no session store, so `bearerAuth()` works
without `sessionMiddleware()`.

`jwt` is a standalone primitive if you need tokens outside the guard:

```ts
const token = await jwt.sign({ sub: "42", role: "admin" }, { expiresIn: "7d" });
const payload = await jwt.verify(token); // { sub, role, iat, exp } | null
```

`verify()` returns `null` — never throws — for a token that's malformed,
tampered, expired, not-yet-valid, or fails an `issuer`/`audience` check. Only
HS256 is accepted: `alg: none` and asymmetric algorithms are refused, closing the
classic JWT algorithm-confusion hole. `sign()` accepts `expiresIn` (seconds, or a
duration string like `"30s"`, `"15m"`, `"1h"`, `"7d"`), plus `subject`, `issuer`,
`audience`, and a `secret` override.

## Opaque access tokens

A JWT is stateless — you can't revoke one without extra machinery. When you need
**revocable, scoped** API tokens (a "personal access tokens" screen, per-token
abilities, "log out this device"), use the database-backed token store instead. A
token is a row you can delete, so revocation is instant.

Store them in a `personal_access_tokens` table (all timestamps epoch-ms):

```ts
selector TEXT UNIQUE, hash TEXT, tokenable_id TEXT, name TEXT,
abilities TEXT, last_used_at INTEGER, expires_at INTEGER, created_at INTEGER
```

Mint a token after verifying credentials — the plaintext is shown **once**:

```ts
import { createToken } from "@shaferllc/keel/core";

const { token } = await createToken(user.id, {
  abilities: ["posts:read", "posts:write"], // or ["*"] for everything
  expiresIn: "30d",                          // omit for no expiry
  name: "CLI token",
});
return response.json({ token }); // "keel_<selector>.<verifier>"
```

Protect routes with `tokenAuth()` — it verifies the `Bearer` token, makes its
owner the authenticated user, and can require abilities:

```ts
import { tokenAuth, auth, token, tokenCan } from "@shaferllc/keel/core";

router.get("/api/posts", async () => response.json(await auth().user()))
  .use(tokenAuth({ abilities: ["posts:read"] }));

// inside a handler, inspect the verified token:
token();               // { tokenableId, abilities, expiresAt, … } | null
tokenCan("posts:write"); // boolean
```

The token splits into a public **selector** (indexed, for lookup) and a secret
**verifier** (stored only as a SHA-256 hash), so a leaked database can't mint
working tokens — and verification needs no `RETURNING`, so it's portable across
every driver. Manage tokens with `listTokens(userId)`, `revokeToken(selector)`,
and `revokeTokens(userId)` (log out everywhere). Verifying an expired token
deletes it in passing, so the table self-prunes.

**JWT vs. opaque:** reach for `jwt` when you want zero-lookup, stateless tokens
(and don't need revocation); reach for `createToken`/`tokenAuth` when you need
revocation, per-token scopes, or last-used tracking.

## Basic authentication

For internal tools and quick gates, `basicAuth()` implements HTTP Basic auth —
the browser's native `username` / `password` prompt. Always behind HTTPS, since
the credentials ride on every request:

```ts
import { basicAuth, auth, hash } from "@shaferllc/keel/core";

router.get("/admin", () => response.json(auth().id())).use(
  basicAuth(async (username, password) => {
    const user = await db.users.findByEmail(username);
    const ok = await hash.verify(user?.password ?? hash.dummy, password);
    return ok && user ? user.id : false; // return the id to log them in, or false
  }, { realm: "Admin" }),
);
```

The verifier returns the user's id (logs them in for the request), `true` (allow
without an identity), or a falsy value (reject). On rejection `basicAuth` answers
`401` with a `WWW-Authenticate` challenge so the browser re-prompts.

## Social sign-in

"Sign in with GitHub/Google/Discord" lives in its own guide —
[Social authentication](./social-auth.md).

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
