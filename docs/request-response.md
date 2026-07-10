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
`request.status`, `request.ip()`, `request.ips()`, `request.hasBody()`,
`request.headers()`, and `request.raw` (the underlying web `Request`).

## File uploads

Uploaded files come back as web-standard `File` objects (works on Node and the
edge — no temp directory, no streaming to disk):

```ts
const avatar = await request.file("avatar");   // File | undefined
const docs = await request.files("docs");       // File[]
const all = await request.allFiles();           // { field: File | File[] }

if (avatar) {
  avatar.name;                 // "photo.png"
  avatar.size;                 // bytes
  avatar.type;                 // "image/png" (client-supplied)
  const bytes = await avatar.arrayBuffer();  // persist via R2/S3/fs yourself
}
```

Validate a file with your schema (Keel stays schema-agnostic):

```ts
const Upload = z.object({
  avatar: z.instanceof(File).refine((f) => f.size < 2_000_000, "Too large"),
});
```

## Content negotiation

```ts
request.accepts(["application/json", "text/html"]); // best match, or null
request.types();                                     // accepted types, ordered
request.language(["en", "fr"]);                       // best language, or null
request.languages();
```

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
response.type("text/csv").append("vary", "accept");
response.removeHeader("x-powered-by");
response.cookie("flash", "saved").redirect("/");
```

## Aborting with guards

```ts
response.abort("Not found", 404);              // always
response.abortIf(!user, "Not found", 404);     // if truthy
response.abortUnless(user.isAdmin, "Forbidden", 403);
```

`abort()` throws an `HttpException`, which the kernel renders (see
[Errors](./errors.md)).

## Standalone shortcuts

Every reader/writer also exists as a flat helper for terse handlers:
`json()`, `text()`, `html()`, `redirect()`, `param()`, `query()`, `header()`,
`body()`. Use whichever reads best — they resolve the same request.
