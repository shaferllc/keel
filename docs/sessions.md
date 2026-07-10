# Sessions

Keel ships a cookie-backed session store. There's no external service to run, so
it works the same on Node and on the edge. Session data lives in an HTTP-only
cookie, signed by the browser's same-origin rules.

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

## How it works

`sessionMiddleware()` reads the session cookie before your handler runs and
writes it back afterward. Data is JSON, base64-encoded into the cookie. Because
it's cookie-backed there's a ~4KB size budget — keep sessions small (an id, a
few flags), not whole objects. For larger sessions, swap in your own middleware
that persists to a store and stashes the data on the context the same way.
