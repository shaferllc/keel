# Testing

Test your app by **injecting requests** — no server, no port, no network — and
asserting on the response. `testClient()` wraps your app's Hono instance (which
already does fetch-style injection) with verb helpers and fluent assertions, the
way Fastify's `inject()` works.

## The client

Build a client from an `Application` and fire requests:

```ts
import { test } from "node:test";
import { Application, Router, json, testClient } from "@shaferllc/keel/core";

async function makeApp() {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/health", () => json({ ok: true }));
  return app;
}

test("health check", async () => {
  const client = testClient(await makeApp());
  const res = await client.get("/health");
  res.assertStatus(200).assertJson({ ok: true });
});
```

`testClient()` accepts an **`Application`** (built through a fresh kernel), an
**`HttpKernel`** (use this if you need global middleware registered with
`kernel.use(...)`), or anything with a `request()` (a built Hono instance).

## Requests

Verb helpers cover the common methods; `post` / `put` / `patch` take a body that's
JSON-encoded automatically:

```ts
await client.get("/users");
await client.get("/users?active=true");
await client.post("/users", { email: "a@b.com", name: "Ada" }); // sends JSON
await client.put("/users/1", { name: "Grace" });
await client.delete("/users/1");

// full control — pass a RequestInit for headers, custom bodies, etc.
await client.request("/users", { method: "POST", headers: { authorization: "Bearer x" }, body });
```

## The response

Every call resolves to a `TestResponse`. The body is **pre-buffered**, so reads
are synchronous and repeatable (no "body already consumed"):

```ts
const res = await client.get("/user");
res.status;            // 200
res.header("content-type");
res.text();            // the raw body
res.json<User>();      // parsed (sync — the body is already read)
```

## Assertions

Assertions are chainable and throw a descriptive error (including the body) on
mismatch:

```ts
res.assertStatus(201);
res.assertOk();                          // any 2xx
res.assertJson({ id: 1, email });        // deep-equals the JSON body
res.assertText("pong");
res.assertHeader("content-type", "application/json");
res.assertRedirect("/login");            // 3xx (+ optional Location)

// chain them:
(await client.post("/users", body)).assertStatus(201).assertJson({ id: 2, ...body });
```

## Testing with middleware

When your test needs global middleware (sessions, request logging, auth), build
the kernel yourself and hand it to `testClient`:

```ts
const app = await makeApp();
const kernel = new HttpKernel(app);
kernel.use(sessionMiddleware());
kernel.use(requestLogger());
const client = testClient(kernel);
```

## API reference

### `testClient(target)`

`testClient(target: Application | HttpKernel | { request(...) }): TestClient`

Builds a `TestClient`. An `Application` is built through a fresh `HttpKernel`; pass
a kernel to register global middleware first.

### `TestClient`

| Method | Signature |
|--------|-----------|
| `get` / `delete` | `(path, init?) => Promise<TestResponse>` |
| `post` / `put` / `patch` | `(path, body?, init?) => Promise<TestResponse>` — body JSON-encoded |
| `request` | `(path, init?) => Promise<TestResponse>` — the low-level form |

### `TestResponse`

Body pre-buffered; reads are synchronous.

| Member | Notes |
|--------|-------|
| `status` | the response status |
| `header(name)` | a response header, or `null` |
| `text()` / `json<T>()` | the body (raw / parsed) |
| `assertStatus(n)` / `assertOk()` | status is `n` / any 2xx |
| `assertJson(v)` | JSON body deep-equals `v` |
| `assertText(s)` / `assertHeader(n, v)` | exact body / header match |
| `assertRedirect(location?)` | 3xx, optionally to `location` |
| `raw` | the underlying `Response` |

All assertions return `this` (chainable) and throw on mismatch.
