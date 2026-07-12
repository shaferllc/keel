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

## Authenticated requests

The client's `withX` methods return a **copy**, so a client configured once can be
reused without leaking into other tests:

```ts
const authed = client.withToken("tok_123"); // Authorization: Bearer tok_123

await authed.get("/me");
await client.get("/me"); // still anonymous
```

| Method | Sends |
|--------|-------|
| `withToken(token)` | `Authorization: Bearer <token>` |
| `withBasicAuth(user, pass)` | `Authorization: Basic <base64>` |
| `withHeader(name, value)` / `withHeaders({…})` | any header |
| `withCookie(name, value)` / `withCookies({…})` | a `Cookie` header |
| `acceptJson()` | `Accept: application/json` |

## Forms and uploads

```ts
await client.form("/login", { email: "a@b.com", password: "s3cret" }); // url-encoded
await client.multipart("/avatar", { file: new Blob([png]), name: "ada" }); // file upload
```

## More response assertions

```ts
res.assertOk(); // 2xx
res.assertCreated(); // 201
res.assertNoContent(); // 204
res.assertUnauthorized(); // 401
res.assertForbidden(); // 403
res.assertNotFound(); // 404
res.assertUnprocessable(); // 422
res.assertServerError(); // 5xx
```

**`assertJsonContains` is a subset match** — the one you usually want. It pins the
fields the test is about and ignores the rest, so adding a field to a response
doesn't break twenty tests:

```ts
res.assertJsonContains({ user: { email: "a@b.com" } });
```

`assertJson` still deep-equals the whole body, when that's what you mean.

```ts
res.assertSee("Welcome back"); // body contains
res.assertDontSee("Sign up");

res.assertHeader("content-type", "application/json");
res.assertHeaderMissing("x-debug");

res.assertCookie("session"); // was set
res.assertCookie("session", "abc123"); // ...with this value
res.assertCookieMissing("admin");

res.dump(); // print status, headers, body — when you're stuck
```

### Validation

A failed `validate()` returns a 422 with per-field errors, so a test can assert on
the field rather than the message:

```ts
const res = await client.post("/users", { email: "nope" });

res.assertValidationErrors("email", "password");
res.assertNoValidationError("name");
```

## Test doubles

Keel's fakes swap out a real backend for a recording one, so a test can assert
that something *would* have happened without it actually happening — no email
sent, no card charged, no file uploaded.

| Fake | Replaces | Assertions |
|------|----------|------------|
| [`fakeMail()`](./mail.md#in-tests) | the mailer | `assertSent`, `assertQueued`, … |
| [`fakeQueue()`](./queues.md#in-tests) | the queue | `assertPushed`, `assertNothingPushed`, … |
| [`fakeDisk()`](./storage.md#testing) | a storage disk | `assertExists`, `assertContents`, … |
| [`events().fake()`](./events.md#testing) | the emitter | `assertEmitted`, `assertNotEmitted`, … |
| [`hash.fake()`](./hashing.md) | PBKDF2 | — (just makes it fast) |

```ts
const mailer = fakeMail();
const queue = fakeQueue();

await registerUser({ email: "ada@example.com" });

mailer.assertQueued((m) => m.subject === "Welcome");
queue.assertPushed(SendWelcome);
```

For anything else, `swap()` replaces a container binding:

```ts
swap(PaymentGateway, () => new FakeGateway());
```

### Spies

The smallest double: a function that records how it was called.

```ts
import { spy, spyOn, restoreSpies } from "@shaferllc/keel/core";

const send = spy<[string], void>();
notify(send);

assert.equal(send.callCount, 1);
assert.ok(send.calledWith("hello"));
```

`spyOn` replaces a method on an object. It **calls through** by default — so you're
observing, not stubbing — until you tell it otherwise:

```ts
const charge = spyOn(gateway, "charge"); // still really charges
charge.returns(receipt); // now it doesn't

restoreSpies(); // put every spied method back
```

## Controlling time

Testing "this token expires in an hour" shouldn't take an hour.

```ts
import { freezeTime, timeTravel, restoreTime } from "@shaferllc/keel/core";

freezeTime("2026-07-11T12:00:00Z");

const token = await jwt.sign({ sub: "1" }, { expiresIn: "1h" });
assert.ok(await jwt.verify(token)); // valid now

timeTravel(61 * 60 * 1000); // an hour and a minute later
assert.equal(await jwt.verify(token), null); // expired

restoreTime();
```

`freezeTime()` mocks `Date` and `Date.now()`. It does **not** mock timers — a
`setTimeout` still fires on the real clock — and `new Date("2020-01-01")` still
parses normally. Only "what time is it *now*" is frozen.

## Resetting state between tests

Keel's fakes, disks, queues, and cache are process-global, so one test can leak
into the next. `resetState()` puts it all back:

```ts
import { resetState } from "@shaferllc/keel/core";

afterEach(() => resetState());
```

It restores every fake (mail, queue, disk, hash), unfreezes the clock, drops event
listeners, empties the cache, and gives you a fresh lock store. It does **not**
touch the database.

For that, `truncate()`:

```ts
afterEach(() => truncate("comments", "posts", "users")); // children before parents
```

It deletes rows rather than rolling back a transaction, so it works on every driver
(D1, Postgres, libSQL) instead of only the ones with savepoints.

## Database assertions

Assert against the database directly, rather than through an endpoint:

```ts
import { assertDatabaseHas, assertDatabaseMissing, assertDatabaseCount } from "@shaferllc/keel/core";

await client.post("/users", { email: "ada@example.com" });

await assertDatabaseHas("users", { email: "ada@example.com" });
await assertDatabaseHas("users", { active: 1 }, 1); // exactly one match
await assertDatabaseMissing("users", { email: "deleted@example.com" });
await assertDatabaseCount("users", 1);
await assertDatabaseEmpty("sessions");
```

A failure tells you what it looked for and how many rows the table actually holds.

## Console tests

Run a command in-process — no subprocess, so it's fast and you can assert on it:

```ts
import { runCommand } from "@shaferllc/keel/core";
import { run } from "@shaferllc/keel/cli";
import { createApplication } from "../bootstrap/app.js";

const result = await runCommand(() => run(["node", "keel", "routes"], { createApplication }));

result
  .assertSucceeded() // exit code 0
  .assertOutputContains("GET  /users")
  .assertOutputMatches(/POST\s+\/users/);
```

You pass the command **in**, because a command needs an *application*, and only your
app knows how to build one. That's also why `run()` takes a `createApplication`
factory rather than importing one. Anything that prints and sets an exit code works,
so this is equally good for testing a function you wrote yourself.

`console.log`/`warn` are captured as stdout and `console.error` as stderr; a
command that *throws* is recorded as a failure rather than blowing up the test.

`assertFailed()`, `assertExitCode(n)`, and `assertErrorContains(text)` cover the
rest. `result.stdout`, `result.stderr`, and `result.exitCode` are there if you'd
rather assert by hand.

## Browser tests

Keel doesn't ship a browser driver — that's [Playwright](https://playwright.dev)'s
job, and wrapping it would only put a thinner API in front of a better one.

The test client injects requests *without a server*, which is what makes it fast;
a browser needs a real one. Start the app on a port, point Playwright at it, and
tear it down:

```ts
import { serve } from "@hono/node-server";
import { chromium } from "playwright";

const server = serve({ fetch: new HttpKernel(app).build().fetch, port: 3001 });
const browser = await chromium.launch();

const page = await browser.newPage();
await page.goto("http://localhost:3001/login");
await page.fill("[name=email]", "ada@example.com");
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard");

await browser.close();
server.close();
```

Everything else on this page — the fakes, `freezeTime`, `resetState`, the database
assertions — works the same in a browser test, because it's the same process.

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
