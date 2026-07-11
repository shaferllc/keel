# Request & Response

Beyond the terse `param()` / `json()` shortcuts, the `request` and `response`
accessors give you the full input/output surface — no context threading. They
resolve the active Hono context from async-context storage, which the HTTP
kernel enables for every request, so they only work **inside a request**. Call
one outside a handler and it throws (`json`/`text`/`html`/`redirect` are the
exception — see below).

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

`request.all()` reads the query string and, if the request carries a body,
merges the parsed body over it — JSON bodies via `req.json()`, form bodies
(`multipart/form-data` or `application/x-www-form-urlencoded`) via cached
`FormData`. File fields are dropped from `all()` (reach for `file()`/`files()`).
A missing or malformed body is swallowed — you just get the query values.
`input`/`only`/`except` all build on `all()`, so they're async too.

`request` also exposes `request.method`, `request.path`, `request.url`,
`request.status`, `request.ip()`, `request.ips()`, `request.hasBody()`,
`request.headers()`, and `request.raw` (the underlying web `Request`). For the
raw parsed JSON body without the query merge, use `request.json<T>()`.

> `input`/`only`/`except`/`all` are object methods that lean on `this`. Call
> them off `request` (`request.input(…)`), not destructured (`const { input } =
> request`), or `this` is lost.

### Other content types

`all()` understands JSON and form bodies. For anything else — XML, CSV, a binary
payload, a custom format — read the raw body and parse it yourself. There's no
content-type parser registry to configure (unlike Fastify): parsing is explicit,
so you call the accessor you want.

```ts
await request.text();          // the body as a string  (XML, CSV, …)
await request.arrayBuffer();   // the body as bytes      (protobuf, msgpack, …)
await request.blob();          // the body as a Blob
```

```ts
r.post("/webhook", async () => {
  const xml = await request.text();
  return response.json(parseXml(xml));
});
```

These read from the same underlying `Request` as `request.raw`, so a middleware
can equally parse a custom type once and stash it with `ctx().set("body", …)`.

## Route info

The kernel stashes the matched route on the context, so you can branch on it:

```ts
request.route;              // { name, pattern, methods } | undefined
request.routeIs("users.show");   // true if the matched route is named that
request.subdomain("tenant");     // a param captured from a domain-bound route
```

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

The `FormData` is parsed once per request and cached, so calling `file()`,
`files()`, `allFiles()`, and `all()` in one handler doesn't re-read the body.
`allFiles()` groups repeated field names into an array and single fields into a
lone `File`.

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

`accepts`/`language` parse the relevant `Accept` header by q-weight and return
the highest-preference offered value, honoring `*/*` (or `*`) as "anything" —
which resolves to the first thing you offer. No match returns `null`.

## Cookies

```ts
request.cookie("session");   // one cookie, or undefined
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

Every mutator (`status`, `header`, `type`, `append`, `removeHeader`, `cookie`,
`clearCookie`) returns `response`, so they chain; the terminal
`json`/`text`/`html`/`redirect`/`send` produce the `Response`. `send` inspects
its argument — a non-null object becomes JSON, anything else is stringified to
text.

## Aborting with guards

```ts
response.abort("Not found", 404);              // always
response.abortIf(!user, "Not found", 404);     // if truthy
response.abortUnless(user.isAdmin, "Forbidden", 403);
```

`abort()` throws an `HttpException` (default status `400`), which the kernel
renders (see [Errors](./errors.md)). `abortIf`/`abortUnless` throw the same,
conditionally — handy as one-line guards at the top of a handler.

## Standalone shortcuts

Every reader/writer also exists as a flat helper for terse handlers:
`json()`, `text()`, `html()`, `redirect()`, `param()`, `query()`, `header()`,
`body()`. Use whichever reads best — they resolve the same request.

The response builders (`json`/`text`/`html`/`redirect`) are special: they work
**both** inside a handler and standalone. Inside a request they build on the
context (so status and queued headers/cookies apply); outside one they fall
back to a plain web `Response`. That's what lets you hand one straight to the
router as a static route value — `router.get("/ping", json({ ok: true }))` —
and have it cloned per request.

---

## API reference

### `ctx()`

`ctx(): Context`

Returns the current Hono `Context` from async-context storage — the escape
hatch when you need something the accessors don't wrap.

```ts
import { ctx } from "@shaferllc/keel/core";

ctx().req.raw;          // the web Request
ctx().executionCtx;     // waitUntil, passThroughOnException, …
```

**Notes:** throws if called outside a request (nothing has set up the context).
Everything else in this module is built on it.

### `json(data, status?)`

`json(data: unknown, status?: number): Response`

Serializes `data` to a JSON `Response`.

```ts
import { json } from "@shaferllc/keel/core";

json({ ok: true });
json({ error: "nope" }, 422);
```

**Notes:** works inside a handler (builds on the context, applying any queued
status/headers) and standalone (a plain `Response.json`). Safe as a static
route value.

### `text(body, status?)`

`text(body: string, status?: number): Response`

Returns a `text/plain; charset=UTF-8` response.

```ts
import { text } from "@shaferllc/keel/core";

text("pong");
text("rate limited", 429);
```

**Notes:** dual-mode like `json`. Standalone, it sets the content-type header
itself.

### `html(body, status?)`

`html(body: string, status?: number): Response`

Returns a `text/html; charset=UTF-8` response.

```ts
import { html } from "@shaferllc/keel/core";

html("<h1>Hi</h1>");
```

**Notes:** does not escape `body` — you're responsible for the markup.

### `redirect(location, status?)`

`redirect(location: string, status?: number): Response`

Returns a redirect to `location`.

```ts
import { redirect } from "@shaferllc/keel/core";

redirect("/login");
redirect("/", 301);
```

**Notes:** default status is `302` in standalone mode. Sets the `Location`
header.

### `request`

The flat request accessor. You import it as-is (it's a singleton object, not a
class) and read off it — every access resolves the current context, so it's
always about the in-flight request.

#### `request.method`

`get method(): string`

The HTTP method (`"GET"`, `"POST"`, …).

```ts
if (request.method === "POST") { /* … */ }
```

#### `request.path`

`get path(): string`

The request path, without query string.

```ts
request.path;   // "/users/1"
```

#### `request.url`

`get url(): string`

The full request URL, including query string.

```ts
request.url;    // "https://api.example.com/users/1?tab=posts"
```

#### `request.status`

`get status(): number`

The current response status — useful in middleware after `await next()`.

```ts
await next();
if (request.status >= 500) log(request.path);
```

#### `request.header(name)`

`header(name: string): string | undefined`

A single request header (case-insensitive), or `undefined`.

```ts
request.header("authorization");
```

#### `request.param(name?)`

`param(name?: string): string | Record<string, string>`

One route parameter by name, or all of them as an object when called with no
argument.

```ts
request.param("id");   // "42"
request.param();       // { id: "42" }
```

**Notes:** the return type is a union — narrow it, or prefer the overloaded
standalone `param()` helper when you want a precise `string`.

#### `request.query(name?)`

`query(name?: string): string | undefined | Record<string, string>`

One query-string value, or the whole query object with no argument.

```ts
request.query("q");    // "keel" | undefined
request.query();       // { q: "keel", page: "2" }
```

#### `request.json<T>()`

`json<T = unknown>(): Promise<T>`

The parsed JSON body, typed as `T`.

```ts
const body = await request.json<{ email: string }>();
```

**Notes:** rejects if the body isn't valid JSON. For a query+body merge instead,
use `request.all()`.

#### `request.text()` · `request.arrayBuffer()` · `request.blob()`

`text(): Promise<string>` · `arrayBuffer(): Promise<ArrayBuffer>` · `blob(): Promise<Blob>`

The raw request body, for content types `json()`/`all()` don't handle — parse it
yourself.

```ts
const xml = await request.text();          // XML, CSV, plain text
const bytes = await request.arrayBuffer(); // protobuf, msgpack, binary
```

**Notes:** thin passes to the underlying Hono request, which caches the body, so
these compose with each other (the body isn't re-read).

#### `request.raw`

`get raw(): Request`

The underlying web `Request`.

```ts
request.raw.signal;   // AbortSignal, streaming body, etc.
```

#### `request.route`

`get route(): { name?: string; pattern?: string; methods?: string[] } | undefined`

The matched route descriptor the kernel stashed on the context.

```ts
request.route?.name;   // "users.show"
```

**Notes:** `undefined` if no named route matched (or the kernel didn't set it).

#### `request.routeIs(name)`

`routeIs(name: string): boolean`

Whether the matched route has the given name.

```ts
if (request.routeIs("users.show")) highlightNav();
```

#### `request.subdomain(name)`

`subdomain(name: string): string | undefined`

A subdomain parameter captured from a domain-bound route.

```ts
request.subdomain("tenant");   // "acme" for acme.example.com
```

#### `request.cookie(name?)`

`cookie(name?: string): string | undefined | Record<string, string>`

One request cookie by name, or all cookies with no argument.

```ts
request.cookie("session");   // "abc123" | undefined
request.cookie();            // { session: "abc123" }
```

#### `request.ip()`

`ip(): string | undefined`

The client IP, from `X-Forwarded-For` (first hop) then `X-Real-IP`.

```ts
request.ip();   // "203.0.113.7"
```

**Notes:** trusts proxy headers — only reliable behind a proxy you control.

#### `request.ips()`

`ips(): string[]`

The full `X-Forwarded-For` chain, client first.

```ts
request.ips();   // ["203.0.113.7", "10.0.0.1"]
```

**Notes:** empty array when there's no `X-Forwarded-For`.

#### `request.hasBody()`

`hasBody(): boolean`

True if the request declares a body (has `Content-Length` or
`Transfer-Encoding`).

```ts
if (request.hasBody()) await request.all();
```

#### `request.headers()`

`headers(): Record<string, string>`

All request headers as a plain object (names lower-cased by the runtime).

```ts
request.headers();   // { "content-type": "application/json", … }
```

#### `request.all()`

`all(): Promise<Record<string, unknown>>`

The query string merged with the parsed body (body wins on key collisions).

```ts
const input = await request.all();   // { …query, …body }
```

**Notes:** async. Handles JSON and form bodies; drops file fields; swallows a
missing/invalid body. Backs `input`/`only`/`except`.

#### `request.input(key, fallback?)`

`input<T = unknown>(key: string, fallback?: T): Promise<T>`

A single value from `all()`, with an optional fallback when the key is absent.

```ts
const email = await request.input("email");
const page = await request.input("page", 1);   // T inferred as number
```

**Notes:** the fallback only applies when the key is missing entirely — a
present-but-empty value is returned as-is.

#### `request.only(keys)`

`only(keys: string[]): Promise<Record<string, unknown>>`

Just the named inputs from `all()`.

```ts
await request.only(["email", "name"]);
```

**Notes:** keys not present are omitted (not set to `undefined`).

#### `request.except(keys)`

`except(keys: string[]): Promise<Record<string, unknown>>`

Every input except the named ones.

```ts
await request.except(["password", "_csrf"]);
```

#### `request.file(name)`

`file(name: string): Promise<File | undefined>`

One uploaded file by field name, as a web `File`.

```ts
const avatar = await request.file("avatar");
if (avatar) await store(await avatar.arrayBuffer());
```

**Notes:** `undefined` if the field is absent or wasn't a file.

#### `request.files(name)`

`files(name: string): Promise<File[]>`

All uploaded files for a repeated field name.

```ts
const docs = await request.files("docs");   // File[]
```

**Notes:** empty array when there are none; non-file values are filtered out.

#### `request.allFiles()`

`allFiles(): Promise<Record<string, File | File[]>>`

Every uploaded file, grouped by field name.

```ts
const files = await request.allFiles();   // { avatar: File, docs: File[] }
```

**Notes:** a field with one file maps to a lone `File`; repeated fields map to
`File[]`.

#### `request.accepts(types)`

`accepts(types: string[]): string | null`

The best of the offered content types per the `Accept` header, or `null`.

```ts
switch (request.accepts(["application/json", "text/html"])) {
  case "application/json": return json(data);
  case "text/html": return html(page);
  default: return response.abort("Not acceptable", 406);
}
```

**Notes:** honors `*/*`/`*` (returns the first offered). `null` when nothing
matches.

#### `request.types()`

`types(): string[]`

Accepted content types, ordered by q-weight preference.

```ts
request.types();   // ["text/html", "application/json"]
```

#### `request.language(languages)`

`language(languages: string[]): string | null`

The best of the offered languages per `Accept-Language`, or `null`.

```ts
request.language(["en", "fr"]);   // "fr"
```

#### `request.languages()`

`languages(): string[]`

Accepted languages, ordered by preference.

```ts
request.languages();   // ["fr", "en"]
```

### `response`

The flat response accessor — a singleton object mirroring `request`. Mutators
return `response` (chainable); terminals return a `Response`.

#### `response.json(data, status?)`

`json(data: unknown, status?: number): Response`

Same as the standalone `json()`, but reads nicely after chained mutators.

```ts
response.status(201).json(created);
```

#### `response.text(body, status?)`

`text(body: string, status?: number): Response`

A plain-text response.

```ts
response.text("pong");
```

#### `response.html(body, status?)`

`html(body: string, status?: number): Response`

An HTML response.

```ts
response.html("<h1>Hi</h1>");
```

#### `response.redirect(location, status?)`

`redirect(location: string, status?: number): Response`

A redirect response.

```ts
response.cookie("flash", "saved").redirect("/");
```

#### `response.send(data, status?)`

`send(data: unknown, status?: number): Response`

Sends a value — a non-null object becomes JSON, everything else becomes text.

```ts
response.send({ ok: true });   // JSON
response.send("pong");         // text
```

**Notes:** `null` is treated as non-object, so it's stringified to text
(`"null"`); wrap it in an object if you want JSON `null`.

#### `response.status(code)`

`status(code: number): ResponseHelper`

Sets the response status. Chainable.

```ts
response.status(202).json({ queued: true });
```

#### `response.header(name, value)`

`header(name: string, value: string): ResponseHelper`

Sets a response header. Chainable.

```ts
response.header("x-total", "42").json(rows);
```

#### `response.headers(map)`

`headers(map: Record<string, string>): ResponseHelper`

Sets several response headers at once. Chainable.

```ts
response.headers({ "x-total": "42", "cache-control": "no-store" });
```

#### `response.getHeader(name)` / `response.hasHeader(name)`

`getHeader(name: string): string | null`
`hasHeader(name: string): boolean`

Read a response header set so far — useful in middleware after `await next()`, to
inspect what a handler set.

```ts
kernel.use(async (c, next) => {
  await next();
  if (!response.hasHeader("cache-control")) response.header("cache-control", "no-store");
});
```

#### `response.type(mime)`

`type(mime: string): ResponseHelper`

Sets the `Content-Type`. Chainable.

```ts
response.type("text/csv").send(csv);
```

#### `response.append(name, value)`

`append(name: string, value: string): ResponseHelper`

Appends to a (possibly multi-value) header rather than replacing it. Chainable.

```ts
response.append("vary", "accept").append("vary", "accept-language");
```

#### `response.removeHeader(name)`

`removeHeader(name: string): ResponseHelper`

Removes a response header. Chainable.

```ts
response.removeHeader("x-powered-by");
```

#### `response.cookie(name, value, options?)`

`cookie(name: string, value: string, options?: CookieOptions): ResponseHelper`

Queues a `Set-Cookie`. Chainable.

```ts
response.cookie("session", token, { httpOnly: true, maxAge: 3600 });
```

**Notes:** `options` is Hono's cookie option bag (`httpOnly`, `secure`,
`sameSite`, `maxAge`, `path`, `domain`, …).

#### `response.clearCookie(name, options?)`

`clearCookie(name: string, options?: CookieOptions): ResponseHelper`

Clears a cookie (queues an expired `Set-Cookie`). Chainable.

```ts
response.clearCookie("session");
```

**Notes:** pass the same `path`/`domain` you set the cookie with, or the browser
won't match it.

#### `response.abort(message, status?)`

`abort(message: string, status?: number): never`

Throws an `HttpException` to end the request.

```ts
response.abort("Not found", 404);
```

**Notes:** default status `400`. Return type is `never`, so TypeScript treats
everything after it as unreachable. Rendered by the kernel (see
[Errors](./errors.md)).

#### `response.abortIf(condition, message, status?)`

`abortIf(condition: unknown, message: string, status?: number): void`

Aborts only if `condition` is truthy.

```ts
response.abortIf(!user, "Not found", 404);
```

**Notes:** default status `400`. Doesn't narrow types (return is `void`, not a
type guard).

#### `response.abortUnless(condition, message, status?)`

`abortUnless(condition: unknown, message: string, status?: number): void`

Aborts unless `condition` is truthy.

```ts
response.abortUnless(user?.isAdmin, "Forbidden", 403);
```

**Notes:** default status `400`.

### Standalone shortcuts

Flat helpers for terse handlers — they resolve the same request as `request`.

#### `param(name?)`

`param(): Record<string, string>`
`param(name: string): string`

One route parameter (typed `string`) or all of them.

```ts
import { param } from "@shaferllc/keel/core";

param("id");   // string
param();       // Record<string, string>
```

**Notes:** overloaded, so `param("id")` is precisely `string` — unlike
`request.param`, which returns the union.

#### `query(name?)`

`query(): Record<string, string>`
`query(name: string): string | undefined`

One query value or the whole query object.

```ts
import { query } from "@shaferllc/keel/core";

query("q");   // string | undefined
query();      // Record<string, string>
```

#### `header(name)`

`header(name: string): string | undefined`

A single request header.

```ts
import { header } from "@shaferllc/keel/core";

header("authorization");
```

#### `body<T>()`

`body<T = unknown>(): Promise<T>`

The parsed JSON body — the standalone twin of `request.json<T>()`.

```ts
import { body } from "@shaferllc/keel/core";

const data = await body<{ email: string }>();
```

**Notes:** rejects on invalid JSON.
