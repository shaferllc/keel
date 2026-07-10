# Errors & Exceptions

Throw an exception anywhere — a handler, middleware, or a service deep in the
container — and Keel's HTTP kernel turns it into the right response. No
try/catch in every controller.

## HTTP exceptions

`HttpException` carries a status code and message. Throw it (or one of its
subclasses) to short-circuit a request with a specific status:

```ts
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from "@keel/core";

throw new NotFoundException("Widget not found"); // 404
throw new UnauthorizedException();                // 401
throw new ForbiddenException();                   // 403
throw new HttpException(429, "Slow down");         // any status
throw new HttpException(503, "Down for maintenance", { "Retry-After": "120" });
```

A controller that always throws can be typed `: never`:

```ts
show(c: Ctx): never {
  throw new NotFoundException();
}
```

## How responses are rendered

The kernel negotiates the response by `Accept` and by your `app.debug` config:

| Situation | Response |
|-----------|----------|
| Client accepts JSON | `{ "error": "...", "status": 404 }` |
| Client accepts HTML | A rendered error page |
| `app.debug = true`, unexpected error | Full message + **stack trace** (page + JSON) |
| `app.debug = false`, unexpected 500 | Generic `Internal Server Error`, internals hidden |
| Thrown `HttpException` | Its status + message (shown even in production) |

Unexpected errors (anything that isn't an `HttpException`) become `500`. In
production their message and stack are hidden so you never leak internals; the
intentional message on an `HttpException` is always shown.

## Unmatched routes

Any request that doesn't match a route is turned into a `404` automatically —
same rendering as a thrown `NotFoundException`:

```
GET /does-not-exist  →  404  { "error": "No route for GET /does-not-exist", "status": 404 }
```

## The debug error page

When `app.debug` is on and the client is a browser, the kernel renders a
readable error page with the status, message, request line, and a formatted
stack trace — so you see what broke without digging through logs. Turn debug off
(via `APP_DEBUG=false`) in production.

## Validation errors

`ValidationException` is a `422` that carries per-field messages, which appear in
the JSON body under `errors`:

```ts
import { ValidationException } from "@keel/core";

throw new ValidationException({ email: ["The email is invalid."] });
// -> 422  { "error": "The given data was invalid.",
//           "status": 422, "errors": { "email": ["The email is invalid."] } }
```

## Customizing the handler

Override the whole thing from your app's HTTP kernel with `onError()`:

```ts
// app/Http/Kernel.ts
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.onError((err, c) => {
      // report to your logging service, then render however you like
      return c.json({ oops: true }, 500);
    });
  }
}
```

Or override the protected `renderException(err, c)` method to keep the default
routing but change the presentation.
