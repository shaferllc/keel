# Securing SSR apps

Two middlewares harden server-rendered apps: `securityHeaders()` sets the
defensive HTTP headers browsers act on, and `csrf()` blocks cross-site form
submissions. (For cross-origin API access, see [CORS](./cors.md).)

## Security headers

`securityHeaders()` sets a Content-Security-Policy, HSTS, and the clickjacking /
MIME-sniffing / referrer guards in one place:

```ts
import { securityHeaders } from "@shaferllc/keel/core";

this.use(securityHeaders()); // sensible defaults

this.use(
  securityHeaders({
    csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://cdn.example.com"] },
    hsts: { maxAge: 15552000, includeSubDomains: true },
    frameGuard: "DENY",
  }),
);
```

| Option | Header | Default |
|--------|--------|---------|
| `csp` | `Content-Security-Policy` | off (opt-in) |
| `hsts` | `Strict-Transport-Security` | off (opt-in) |
| `frameGuard` | `X-Frame-Options` | `"SAMEORIGIN"` |
| `noSniff` | `X-Content-Type-Options: nosniff` | on |
| `referrerPolicy` | `Referrer-Policy` | `strict-origin-when-cross-origin` |

Set any of these to `false` to omit the header. `csp` accepts a ready-made string
or a **directives object** whose camelCase keys become the kebab-case spelling
(`defaultSrc` → `default-src`, `scriptSrc` → `script-src`).

**HSTS is sticky** — once a browser sees it, it refuses plain HTTP for `maxAge`
seconds. Only enable it once HTTPS works everywhere, and start with a short
`maxAge` (say a day) while you test.

## CSRF protection

`csrf()` guards against forged form submissions. It keeps a token in the
[session](./sessions.md) and rejects any `POST`/`PUT`/`PATCH`/`DELETE` that
doesn't echo it back — with `419 Page Expired`. It needs `sessionMiddleware()`
installed first:

```ts
import { sessionMiddleware, csrf } from "@shaferllc/keel/core";

this.use(sessionMiddleware());
this.use(csrf());
```

### In forms

Drop `csrfField()` into any form — it renders a hidden `_token` input:

```ts
import { csrfField } from "@shaferllc/keel/core";

`<form method="POST" action="/posts">
  ${csrfField()}
  <button>Save</button>
</form>`
```

Or read the raw token with `csrfToken()` to place it yourself.

### In SPAs

`csrf()` also writes a readable `XSRF-TOKEN` cookie. Axios and most fetch wrappers
send it back automatically as the `X-XSRF-TOKEN` header, so AJAX requests are
covered with no extra code. The token is accepted from the `X-CSRF-Token` /
`X-XSRF-Token` header or a `_token` / `_csrf` body field.

### Exempting routes

Webhooks and provider callbacks can't send your token — exempt them (a trailing
`*` matches a prefix):

```ts
this.use(csrf({ except: ["/webhooks/*", "/payments/callback"] }));
```
