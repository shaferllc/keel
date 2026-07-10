# Request & Response

Beyond the terse `param()` / `json()` shortcuts, the `request` and `response`
accessors give you the full input/output surface — no context threading.

## Reading input

```ts
import { request } from "@shaferllc/keel/core";

request.param("id");            // route parameter
request.query("q");             // query-string value
request.header("authorization");

// merged query + parsed body (async)
await request.all();                    // { …query, …body }
await request.input("email");           // one value from query or body
await request.input("page", 1);         // with a fallback
await request.only(["email", "name"]);  // a subset
await request.except(["password"]);     // everything but these
```

`request` also exposes `request.method`, `request.path`, `request.url`,
`request.status`, `request.ip()`, and `request.raw` (the underlying web
`Request`).

## Cookies

```ts
request.cookie("session");   // one cookie
request.cookie();            // all cookies as an object

response.cookie("session", token, { httpOnly: true, maxAge: 3600 });
response.clearCookie("session");
```

## Writing output

```ts
import { response } from "@shaferllc/keel/core";

response.json({ ok: true });
response.text("hello");
response.html("<h1>Hi</h1>");
response.redirect("/login");
response.send(anything);              // objects → JSON, else text

response.status(201).json(created);   // chainable
response.header("x-total", "42").json(rows);
response.cookie("flash", "saved").redirect("/");
```

## Aborting

`response.abort()` throws an `HttpException`, which the kernel renders (see
[Errors](./errors.md)):

```ts
if (!user) response.abort("Not found", 404);
```

## Standalone shortcuts

Every reader/writer also exists as a flat helper for terse handlers:
`json()`, `text()`, `html()`, `redirect()`, `param()`, `query()`, `header()`,
`body()`. Use whichever reads best — they resolve the same request.
