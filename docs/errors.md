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
} from "@shaferllc/keel/core";

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

The third `headers` argument is emitted on the response — handy for a `503` with
`Retry-After`, or a `429` with rate-limit headers:

```ts
throw new HttpException(429, "Slow down", { "Retry-After": "30" });
```

For terse, inline guards you don't need to construct an exception at all — the
[request](./request-response.md) object's `abort`, `abortIf`, and `abortUnless`
helpers throw a plain `HttpException` for you:

```ts
request.abortUnless(user.isAdmin, "Forbidden", 403);
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
intentional message on an `HttpException` is always shown. A subclass `code` is
added to the JSON body (`{ error, status, code }`), and any `headers` you passed
are set on the response.

The title on both the JSON and HTML paths comes from
[`STATUS_TEXT`](#status_text) — the kernel looks the status up there (`STATUS_TEXT[status] ?? "Error"`),
so a custom status still gets a sensible label as long as it's in the map.

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
import { ValidationException } from "@shaferllc/keel/core";

throw new ValidationException({ email: ["The email is invalid."] });
// -> 422  { "error": "The given data was invalid.",
//           "status": 422, "errors": { "email": ["The email is invalid."] } }
```

## Custom exceptions

Extend `HttpException` to model your domain errors. Add a `code` (surfaced in the
JSON body), and optionally make the exception render or report itself:

```ts
import { HttpException } from "@shaferllc/keel/core";
import type { Context } from "hono";

export class PaymentRequiredException extends HttpException {
  code = "E_PAYMENT_REQUIRED";

  constructor() {
    super(402, "Payment is required to continue.");
  }

  // Optional: render this exception itself.
  handle(c: Context) {
    return c.json({ error: this.message, code: this.code, upgrade: "/billing" }, this.status);
  }

  // Optional: called before rendering — log/report it.
  report() {
    metrics.increment("payment_required");
  }
}

throw new PaymentRequiredException();
```

- **`code`** → added to the JSON error body (`{ error, status, code }`).
- **`handle(c)`** → if it returns a `Response`, the kernel uses it verbatim. If it
  returns anything else, the kernel falls back to the default rendering.
- **`report()`** → always called (and awaited) first; failures there never mask
  the original error.

Both hooks are duck-typed, not tied to a base class: the kernel calls any thrown
value that happens to have a `report` and/or `handle` method. The built-in
subclasses don't define either — they render through the default path.

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

> A registered `onError` handler takes precedence over an exception's own
> `handle(c)` — the custom handler wins, and self-handling is skipped. `report()`
> still runs first, either way.

---

## API reference

Every exception below is a subclass of `HttpException`, which extends the native
`Error`. You throw them; you never catch them yourself — the kernel does. All are
exported from `@shaferllc/keel/core`.

### `HttpException`

The base semantic HTTP error: a status code, a message, and optional response
headers. Throw it directly for any status that doesn't have a dedicated subclass.

#### `new HttpException(status, message?, headers?)`

`new HttpException(status: number, message?: string, headers?: Record<string, string>): HttpException`

Constructs an error carrying `status` and `message`. Omit `message` to fall back
to the status text.

```ts
throw new HttpException(409, "That email is taken");
throw new HttpException(503, "Down for maintenance", { "Retry-After": "120" });
throw new HttpException(429); // message defaults to "Too Many Requests"
```

**Notes:** the message defaults to `STATUS_TEXT[status]`, then `"Error"` if the
status isn't in the map. Exposes three readonly-ish fields the kernel reads:
`status` (number), `headers` (optional, emitted on the response), and `code`
(optional `string`, added to the JSON body when set). It also sets `name` to
`"HttpException"`. There's no built-in `handle`/`report` — add those on a subclass
to self-render or self-report (see [Custom exceptions](#custom-exceptions)).

### `NotFoundException`

A `404`. Thrown automatically for unmatched routes, and by `Model.findOrFail`.

#### `new NotFoundException(message?)`

`new NotFoundException(message?: string): NotFoundException`

Constructs a `404`. Message defaults to `"Not Found"`.

```ts
throw new NotFoundException();               // "Not Found"
throw new NotFoundException("Widget 42 not found");
```

**Notes:** `status` is fixed at `404`; `name` is `"NotFoundException"`. The kernel
also throws this for any request that matches no route.

### `UnauthorizedException`

A `401` — the request isn't authenticated. Reach for it when there's no valid
session or credentials; use `ForbiddenException` when the user is known but not
allowed.

#### `new UnauthorizedException(message?)`

`new UnauthorizedException(message?: string): UnauthorizedException`

Constructs a `401`. Message defaults to `"Unauthorized"`.

```ts
throw new UnauthorizedException();
throw new UnauthorizedException("Session expired");
```

**Notes:** `status` is fixed at `401`; `name` is `"UnauthorizedException"`.

### `ForbiddenException`

A `403` — the request is authenticated but not permitted.

#### `new ForbiddenException(message?)`

`new ForbiddenException(message?: string): ForbiddenException`

Constructs a `403`. Message defaults to `"Forbidden"`.

```ts
throw new ForbiddenException();
throw new ForbiddenException("You can't edit this post");
```

**Notes:** `status` is fixed at `403`; `name` is `"ForbiddenException"`.

### `ValidationException`

A `422` carrying per-field error messages. The kernel adds them to the JSON body
under `errors`.

#### `new ValidationException(errors, message?)`

`new ValidationException(errors: Record<string, string[]>, message?: string): ValidationException`

Constructs a `422` from a map of field name → messages.

```ts
throw new ValidationException({
  email: ["The email is invalid."],
  password: ["Too short.", "Must contain a number."],
});
// -> 422 { "error": "The given data was invalid.", "status": 422,
//          "errors": { "email": [...], "password": [...] } }
```

**Notes:** `status` is fixed at `422`; `name` is `"ValidationException"`. Message
defaults to `"The given data was invalid."`. The field map is exposed as the
readonly `errors` property, which the kernel serializes into the response body.
Keel's [`validate()`](./validation.md) helper throws this for you on a failed
parse.

### Constants

#### `STATUS_TEXT`

`const STATUS_TEXT: Record<number, string>`

Maps HTTP status codes to their reason phrases. Used to title error pages/bodies
and to supply the default message for `HttpException`.

```ts
import { STATUS_TEXT } from "@shaferllc/keel/core";

STATUS_TEXT[404]; // "Not Found"
STATUS_TEXT[419]; // "Page Expired"
STATUS_TEXT[418] ?? "Error"; // not in the map
```

**Notes:** covers the statuses Keel uses (`400`, `401`, `403`, `404`, `405`,
`409`, `419`, `422`, `429`, `500`, `503`). Lookups for anything else are
`undefined`, which the kernel falls back to `"Error"` for. It's a plain mutable
object — you can add entries for custom statuses so they render with a label.
