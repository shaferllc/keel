# Authentication

Session-based auth built on the pieces you already have: [sessions](./sessions.md)
hold the login, [hashing](./hashing.md) checks passwords. `auth()` ties them
together.

Requires [`sessionMiddleware()`](./sessions.md) in your HTTP kernel.

## Tell Keel how to load a user

Register a **user provider** once (in a service provider) — a function that
returns a user for an id. Keel stays database-agnostic, so this is wherever your
users live:

```ts
import { setUserProvider } from "@shaferllc/keel/core";

setUserProvider((id) => db.users.find(id));
```

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

## Reading the current user

```ts
auth().check();        // is someone logged in?
auth().guest();        // …or not?
auth().id();           // the user id, or null
await auth().user();   // the full user (via your provider), or null
```

## Logging out

```ts
auth().logout();
return response.redirect("/");
```

## Protecting routes

`authGuard()` rejects unauthenticated requests. Register it as
[named middleware](./middleware.md) and apply it wherever you need:

```ts
import { authGuard } from "@shaferllc/keel/core";

router.named({ auth: authGuard({ redirectTo: "/login" }) });

router.get("/dashboard", [DashboardController, "index"]).use("auth");
router.group(() => { /* … */ }).use("auth");
```

Without `redirectTo`, the guard returns `401 Unauthenticated` (ideal for APIs).

## Registration

Registration is the same flow in reverse — hash the password on the way in:

```ts
const user = await db.users.create({
  email,
  password: await hash.make(password),
});
auth().login(user.id);
```
