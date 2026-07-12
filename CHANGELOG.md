# Changelog

All notable changes to Keel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.74.3] — 2026-07-11

### Fixed

- **v0.74.0–v0.74.2 did not build from a clean checkout**, which made them unusable
  as a dependency (a git install runs `npm run build` through `prepare`). An
  in-progress `src/api` feature was committed by accident, half-written, and it
  didn't compile; a leftover `cp src/api/…` in the build script then failed once the
  feature was untracked.

  It is now untracked again — the package exports and the build config no longer
  include it — so the released tree is back to what it was in 0.73.0 plus the
  environment validation that 0.74.0 was actually about. A clean-clone build is
  verified before tagging now, rather than after.

## [0.74.0] — 2026-07-11

### Added

- **Environment validation — fail at boot, not at 3am.** `env("DATABASE_URL")`
  hands back whatever is (or isn't) in `process.env`, so a missing variable boots a
  perfectly healthy-looking app that dies on the first request that needs it, in
  production, at night. `defineEnv()` checks the whole environment up front and
  **refuses to start** otherwise.

  ```ts
  export const env = defineEnv({
    APP_KEY: envVar.string({ required: true, description: "32+ random characters" }),
    PORT: envVar.number({ default: 3000 }),
    NODE_ENV: envVar.enum(["development", "test", "production"], { default: "development" }),
    DATABASE_URL: envVar.url({ required: true }),
    SENTRY_DSN: envVar.string(),
  });

  env.PORT;       // number — not "3000"
  env.NODE_ENV;   // "development" | "test" | "production" — not string
  env.SENTRY_DSN; // string | undefined
  ```

  - The value types are **inferred from the rules**: a `number` rule gives a
    `number`, an `enum` gives the literal union rather than `string`, and anything
    optional without a default is `| undefined` — so you can't forget to handle it.
  - **Every problem is reported at once**, not the first one. Fixing a deploy one
    missing variable per restart is its own small hell.
  - Rules: `envVar.string/number/boolean/enum/url`, each with `required`, `default`,
    `description` (shown in the failure, so they know what to set), and `validate`.
    `url` catches a truncated connection string; `boolean` accepts the spellings
    people actually use (`1`, `yes`, `on`).
  - **An empty string counts as absent** — `PORT=` in a `.env` is a typo, not a
    deliberate empty port.
  - The returned object is frozen, so nothing reassigns your config at runtime.

## [0.73.0] — 2026-07-11

### Added

- **Database transactions.** `transaction(fn)` commits when `fn` returns and
  **rolls back if it throws** — so two related writes either both land or neither
  does, and a failure between them can't leave the card charged and the order
  missing. The error is rethrown after the rollback; nothing is swallowed.
  - **Queries inside are ambient.** `db()`, models, and relations all pick up the
    open transaction without being handed it, because it lives in
    `AsyncLocalStorage` rather than a module global — so two requests running
    transactions at once can't steal each other's connection. `transaction()` also
    passes an explicit handle (`tx.table()`, `tx.write()`, `tx.rollback()`) for
    when you'd rather be obvious, and `inTransaction()` reports whether one is open.
  - **Nesting uses savepoints.** A `transaction()` inside another doesn't open a
    second transaction — databases don't have those — it takes a savepoint, so an
    inner failure rolls back only the inner work and the outer transaction carries
    on. Without that, a nested helper's failure would silently abandon its caller's
    writes too.
  - **The pooling trap, closed.** A transaction needs every statement on *one*
    connection, but a pool hands each statement to whichever is free — so `BEGIN`
    issued through a pool wraps nothing, the `COMMIT` commits nothing, and a
    failure half-writes. It looks like it works. `Connection` therefore gains an
    optional `begin()`: the Postgres adapter now checks a connection out of the
    `Pool` (detected via `connect()`), runs the whole transaction on it, and
    releases it afterwards **even if the `COMMIT` throws**. Single-connection
    drivers (a bare `pg.Client`, SQLite, libSQL) need nothing and fall back to
    `BEGIN`/`COMMIT`/`ROLLBACK`.
  - **D1 refuses honestly.** Cloudflare D1 can't hold a transaction open across
    awaits, so `transaction()` on it throws a clear error pointing at
    `database.batch([...])`, rather than letting a `BEGIN` fail cryptically inside
    the driver. A transaction that quietly isn't one is far worse than one that
    refuses to start.

## [0.72.0] — 2026-07-11

### Added

- **A real console.** Commands with **typed arguments and flags**, prompts, a
  terminal UI, and a REPL. `keel make:command greet` scaffolds one; anything in
  `app/Commands` is discovered automatically. See the
  [console guide](https://keeljs.com/docs/console).
  - **The types are inferred from the spec, not cast.** `arg.string()` gives you a
    `string`; `arg.string({ required: false })` gives you `string | undefined`; add
    a default and it's a `string` again. The parsing is generated from the same
    declaration, so the two can't drift apart.
  - `arg.string/number/spread` and `flag.boolean/string/number/array`, each with
    `description`, `default`, `required`, `parse`, and (for flags) a single-letter
    `alias`. The parser handles `--flag value`, `--flag=value`, `--no-flag`,
    `-f value`, bundled shorthands (`-lt 5`), and `--` passthrough.
  - **An unknown flag is an error, not a shrug** — a typo'd `--forse` should tell
    you rather than silently doing nothing. `allowUnknownFlags` opts out.
  - Usage errors print what's wrong **and the command's help**; a thrown error exits
    1 with its message, not a stack trace. A console is a bad place to show someone
    a stack because they mistyped a flag.
  - **Terminal UI**: `info` / `success` / `warning` / `error`, `action()` for
    aligned CREATE/SKIP lines, tables, stickers, numbered instructions, colors, and
    a task runner that **stops at the first failure** (the tasks after it almost
    certainly depended on it, and a cascade of red tells you nothing new). No
    dependency — ANSI codes are a dozen escape sequences, not a package.
  - **Prompts**: `ask`, `secure`, `confirm`, `toggle`, `choice`, `multiple`,
    `autocomplete`, with `default` / `hint` / `validate` / `result`. A failed
    `validate` re-asks rather than dying.
  - **Prompts are testable**, which is the whole point: `createPrompt({ trap: true })`
    lets a test script the answers, and `createUi({ raw: true })` buffers the output
    colorlessly so you can assert on exactly what a command said. An **untrapped
    prompt throws instead of hanging** — otherwise a test would block forever on
    stdin it will never receive, and the suite would just stop, with no failure to
    read. `assertAllTrapsUsed()` catches a question you scripted but never asked.
  - **`keel repl`** — an interactive shell with the application booted: the
    container is up, the providers have run, and `db`, `make`, `cache`, `router`
    and friends are in scope. `.ls` lists them. Poking at a model in a REPL is the
    fastest debugging loop there is, and it shouldn't cost you a throwaway script.

  The built-in commands (`serve`, `routes`, `make:*`, `migrate:*`) and
  package-contributed commands still run through the original console wrapper; your
  commands run on the new system and take precedence over a built-in of the same
  name. Migrating the built-ins across is mechanical and changes none of the API
  above.

## [0.71.0] — 2026-07-11

### Added

- **Pages — page-based routing, where a file *is* a route.** `resources/pages/users/[id].tsx`
  serves `/users/:id`; no route file to keep in sync, no controller, no wiring. New
  [pages guide](https://keeljs.com/docs/pages), and `keel make:page users/[id]`.
  - Conventions: `index.tsx` names its directory, `[id]` is a parameter,
    `[...slug]` is a catch-all, and a leading `_` keeps a file private — so a
    layout or a partial can live beside your pages without becoming a URL.
  - **`loader`** runs before the page renders and its return value arrives as
    `data`; **`middleware`** guards a page (and runs *before* the loader, so a
    refused page never loads its data); **`name`** and **`path`** override the
    derived route name and URL.
  - **Specificity is decided for you.** This is the part file-based routing
    usually gets wrong: register `/users/:id` before `/users/new` and the literal
    page is unreachable forever, because `:id` matches `"new"`. Pages are sorted
    before they're registered — literals beat parameters, parameters beat
    catch-alls — so the file layout stops being a trap.
  - **It drives the router rather than replacing it.** Every page becomes an
    ordinary named route, so `url()` finds it, route middleware applies, and
    `keel routes` lists it. Mix pages and hand-written routes freely, and reach for
    a controller the moment a page outgrows a file.
  - Edge-safe: `pages()` scans the filesystem on Node, while `definePages()` takes
    a build-time manifest — `import.meta.glob("./pages/**/*.tsx", { eager: true })`
    — so the same pages run on Workers.

- **Packages — a redistributable slice of an app.** Routes, a UI, config,
  migrations, and console commands that install with a single `app.register(...)`.
  `ServiceProvider` was already the unit of composition; `PackageProvider` adds the
  conventions a *shippable* package needs, so it can carry its own schema and
  assets instead of asking the host app to wire them by hand. `MigrationRegistry`,
  `CommandRegistry`, `PublishRegistry`. New [packages guide](https://keeljs.com/docs/packages).

- **Watch — a debug dashboard.** Records the requests, queries, exceptions, logs,
  jobs, mail, notifications, cache lookups, events, and scheduled tasks flowing
  through the app, and shows them at `/watch`, with each request linked to the
  queries and logs it produced. Built on a new instrumentation seam (`instrument()`,
  `runRequest()`, `currentRequestId()`) and on `tapLogs()`, which observes every log
  record without changing where logs normally go. Ships as a Keel package, and is
  that system's reference implementation. New [watch guide](https://keeljs.com/docs/watch).

## [0.70.0] — 2026-07-11

### Added

- **Telemetry — distributed tracing with no SDK.** Spans, W3C trace context, and an
  OTLP exporter, in a module you can read. The OpenTelemetry Node SDK is a large
  tree of packages that assumes a Node process; what a trace *is*, though, is
  small — an id, a parent, a start and an end, some attributes, and a documented
  JSON shape to POST them in. This speaks **OTLP/HTTP over `fetch`**, so it runs on
  Workers as happily as on Node, and any collector takes it (Jaeger, Tempo,
  Honeycomb, Grafana, Datadog). New [telemetry guide](https://keeljs.com/docs/telemetry).
  - `trace(name, fn)` opens a span, ends it when `fn` settles, and records a throw
    before rethrowing. Spans **nest automatically** across `await` boundaries — and
    across *concurrent* traces, because the current span lives in
    `AsyncLocalStorage`, not a global, so two in-flight requests can't get tangled.
  - `tracing()` middleware: a server span per request, joined to the caller's trace
    via their `traceparent`, with the trace id written back on the response so a
    user reporting a slow page can be looked up. A 5xx fails the span; a 404
    doesn't — that's a valid answer, not a fault.
  - `injectTraceContext()` for outgoing calls, plus `parseTraceparent()` /
    `traceparent()`. A malformed header starts a fresh trace rather than failing
    the request.
  - `traceIds()` to hang `trace_id` / `span_id` on a log line — the jump from a log
    to the trace it came from.
  - `sampleRatio`, decided **once at the root and inherited by every child**,
    because half a trace is worse than none.
  - `otlpExporter()`, `consoleExporter()`, and `MemoryExporter` for tests. Spans
    batch; `flushTelemetry()` drains them before an isolate goes away.

- **A real testing toolkit.** The test client injects requests without a server;
  this fills in everything around it. See the
  [testing guide](https://keeljs.com/docs/testing).
  - **Request building:** `withToken()`, `withBasicAuth()`, `withHeader(s)`,
    `withCookie(s)`, `acceptJson()` — each returning a **copy**, so a configured
    client can't leak into another test — plus `form()` and `multipart()`.
  - **Response assertions:** `assertJsonContains()` (a subset match — pins the
    fields a test is about, so adding an unrelated field doesn't break twenty
    tests), `assertSee()` / `assertDontSee()`, `assertValidationErrors(...fields)`,
    `assertCookie()` / `assertCookieMissing()`, `assertHeaderMissing()`, status
    shorthands (`assertCreated`, `assertNotFound`, `assertUnprocessable`, …), and
    `dump()`.
  - **Database assertions:** `assertDatabaseHas()` / `assertDatabaseMissing()` /
    `assertDatabaseCount()` / `assertDatabaseEmpty()`, and `truncate()` — which
    deletes rows rather than rolling back a transaction, so it works on every
    driver rather than only the ones with savepoints.
  - **Time control:** `freezeTime()` / `timeTravel()` / `restoreTime()`, so
    "expires in an hour" doesn't take an hour to test. Mocks `Date` and `Date.now()`
    — not timers, and not `new Date("2020-01-01")`; only "what time is it *now*".
  - **Spies:** `spy()` and `spyOn()`, which **call through by default** — observing
    rather than stubbing — until you tell them otherwise. `restoreSpies()` undoes
    them.
  - **State reset:** `resetState()` restores every fake, unfreezes the clock, drops
    event listeners, empties the cache, and hands back a fresh lock store.
  - **Console tests:** `runCommand(fn)` captures stdout, stderr, and the exit code,
    with `assertSucceeded()` / `assertFailed()` / `assertOutputContains()` and
    friends. You pass the command *in*, because the console entry point belongs to
    your app, not the core.
  - **Browser tests** are documented rather than wrapped: Playwright already does
    this well, and a thinner API in front of it would only get in the way.

## [0.69.1] — 2026-07-11

### Fixed

- **`serveStorage({ signed: true })` now fails loudly on a `basePath` mismatch.**
  `signedUrl()` signs the path the *disk* reports, so a disk handing out
  `/storage/…` while the middleware is mounted at `/private` could never produce a
  matching signature — and every request 403'd, which reads as "your link expired"
  and sends you hunting in the wrong place. It now throws, naming both paths and
  how to line them up.

## [0.69.0] — 2026-07-11

### Added

- **AI-native tooling — write Keel apps with an agent.** A machine-readable
  surface generated from the same source as the human docs, so it never drifts:
  - **An MCP server** (`keel mcp` / the shipped `keel-mcp` bin) exposing Keel's
    docs, full public API (400+ exports), generators, and conventions to any
    [Model Context Protocol](https://modelcontextprotocol.io) client. Tools:
    `keel_overview`, `keel_search_docs`, `keel_read_doc`, `keel_search_api`,
    `keel_list_generators`, `keel_scaffold`. Resources: `keel://overview`,
    `keel://llms-full`, and `keel://docs/<slug>` per guide.
  - **`AGENTS.md` + `CLAUDE.md`** — an agent playbook (import rule, folder map,
    container/provider model, how-to-add-X table, guardrails), shipped in the
    package.
  - **`llms.txt` + `llms-full.txt`** — a [spec-compliant](https://llmstxt.org)
    doc index and a one-file concatenation of every guide, shipped in the package.
  - **`docs/ai.md`** — the "Building Keel apps with AI" guide.
  - **`npm run build:ai`** regenerates `llms.txt`, `llms-full.txt`, and
    `docs/ai-manifest.json` (the index the MCP server reads); wired into `build`.
- **Distributed locks** (`lock()`, `MemoryLockStore`, `LockStore`) — "only one
  of you may do this at a time" across processes and nodes, with a pluggable
  store seam (the core imports no driver). See the locks guide.

  Every acquisition mints an owner token, and release/extend only succeed for the
  owner. That isn't bookkeeping — without it, a lock whose TTL expires mid-work
  gets picked up by process B, and A's late `release()` would delete **B's** lock
  and let a third process in. `run()` takes the lock, runs, and always gives it
  back; `extend()` throws rather than silently no-op'ing once the lock is lost.

- **Internationalization** — ICU message formatting plus the `Intl` formatters
  that go with it, with **no dependency**: Node and Workers both ship full ICU, so plurals,
  currencies, dates, and relative times are the platform's job, and Keel only adds
  the message parser on top.
  - `t(key, data)` / `i18n(locale)`, with an ICU subset covering interpolation,
    `plural` (including exact `=0` branches and `#`), `selectordinal`, `select`,
    `number` (incl. `::currency/USD`), `date`, and `time` — nested arbitrarily
    deep. Plural categories come from the **locale**, not from English.
  - `Intl`-backed `formatNumber` / `formatCurrency` / `formatDate` / `formatTime` /
    `formatRelativeTime` / `formatList` / `formatPlural` / `formatDisplayName` —
    worth using even in a single-locale app.
  - `detectLocale()` middleware (custom resolver → query → cookie →
    `Accept-Language` → default; only **supported** locales are honored, so
    `?lang=xx` can't push the app into a locale you have no translations for) and
    `negotiateLocale()` on its own.
  - Nested or flat translation keys, and a fallback chain that walks `es-MX` →
    configured fallback → `es` → default, so a regional locale can be a handful of
    overrides.
  - A missing key renders as the key itself (the page still works and the gap is
    visible) and fires `i18n.missing`.

- **Mail: queueing, attachments, class-based mails, and a fake.**
  - **`sendLater()`** — put the message on the queue instead of holding the request
    open for an SMTP round trip. Validated at the call site, not on the worker, so
    a malformed message throws where the stack trace means something.
  - **Attachments** — `attach()` (content type inferred from the extension) and
    `embed()` for inline `cid:` images.
  - **`BaseMail`** — a reusable, testable email class; `send()` / `sendLater()`.
  - **Named mailers** — `setMailer(t, o, "marketing")` / `mail("marketing")`.
  - **`fakeMail()` / `restoreMail()`** with `assertSent` / `assertNotSent` /
    `assertSentCount` / `assertQueued` / `assertNotQueued` / `assertQueuedCount` /
    `assertNothingSent`. Sent and queued are tracked separately, and the fake still
    validates, so it can't paper over a message the real mailer would reject.
  - `mail.sending` / `mail.sent` / `mail.queued` events, and a default `replyTo`.

- **Queues: retries, backoff, priority, and a dead-letter list.**
  - **Retries with backoff** — `static maxRetries` and `static backoff` per job
    class (`exponentialBackoff` / `linearBackoff` / `fixedBackoff` / `noBackoff`),
    overridable per dispatch. `maxRetries` defaults to 0 — the safe default for
    work that isn't idempotent.
  - **`failed(error)` hook** and a **dead-letter list** (`driver.failed`): an
    exhausted job is logged, handed to its hook, and kept, rather than vanishing.
  - **Priority** (lower runs first) and per-class `queue` / `priority` defaults.
  - **`JobContext`** (`jobId`, `attempt`, `queue`) readable from `handle()`.
  - **`fakeQueue()` / `restoreQueue()`** with `assertPushed` / `assertNotPushed` /
    `assertPushedCount` / `assertNothingPushed` / `pushedJobs`.

- **Logger: `trace` and `fatal`, sinks, and better redaction.**
  - Levels are now `trace` < `debug` < `info` < `warn` < `error` < `fatal`, plus
    `log(level, …)`, `isLevelEnabled()` / `ifLevelEnabled()` (so an expensive
    context object isn't built for a line nobody will emit), and `enabled: false`.
  - **Sinks** — output goes through a `Sink` function receiving the structured
    `LogRecord`, so logs can go to a file or an HTTP collector instead of the
    console. `MemorySink` collects them for tests.
  - **Redaction** gains `*` wildcard path segments (`"*.password"`), a custom
    `censor`, and `remove` to drop the key outright. It still never mutates the
    caller's object, and it runs *before* the sink, so a custom sink can never see
    the unredacted values.
  - **Named loggers** — `setLogger(logger, "audit")` / `namedLogger("audit")`.

- **`hasApplication()`** — whether an application has been bootstrapped. The queue
  and the mailer use it so they still work in a worker or a unit test that never
  created one.

### Changed

- **A failed queue job no longer takes down the worker.** `work()` used to
  propagate the error and stop draining. It now retries the job, and once the
  retries are exhausted it logs the failure loudly, runs `failed()`, records it in
  the driver's dead-letter list, and **carries on with the rest of the queue** —
  one bad job can't stop the others. `SyncDriver` is the exception: it ran the job
  *inline*, so the caller still gets the error thrown at them.

- **`dispatch()` now materializes the queue defaults**, so a queued job's `options`
  always carry `queue` and `priority`.

## [0.68.0] — 2026-07-11

### Added

- **Storage: signed URLs, direct uploads, and metadata.** Kept keel's "core imports
  no SDK" rule — the `Disk` seam grew *optional* capabilities, so existing disks
  keep working untouched:
  - **Content types.** `put()` now infers the MIME type from the path's extension
    (`.png` → `image/png`), so files stop landing in your bucket as
    `application/octet-stream` — the difference between a browser *rendering* a
    file and *downloading* it. New `WriteOptions` (`contentType`, `cacheControl`,
    `visibility`, custom `metadata`) override it.
  - **`signedUrl(path, { expiresIn })`** — a temporary URL for a private file. A
    disk with backend presigning (S3/R2/GCS) returns the bucket's own; any other
    disk gets one signed with `config('app.key')`. The signature covers the path
    and query but **not the host**, so a signed URL survives a CDN hostname.
  - **`signedUploadUrl(path, { contentType })`** — the browser `PUT`s straight to
    the bucket, so a 50 MB upload never streams through a Worker. Requires a disk
    that can presign; there's no generic fallback, and calling it on one that
    can't throws rather than handing back a URL that won't work.
  - **`serveStorage()`** — middleware that serves a disk's files over HTTP with
    `ETag`/304 and stored `Cache-Control`, and (in `signed: true` mode) rejects
    unsigned or expired requests with a 403. This is what makes app-signed URLs
    real for disks without backend presigning.
  - **`metadata()` / `size()` / `copy()` / `move()`** — using the backend's
    server-side operation when the disk offers one, falling back to
    read-then-write otherwise.
  - **`fakeDisk()` / `restoreDisk()`** with `assertExists` / `assertMissing` /
    `assertContents` / `assertCount`, so tests never touch a real bucket. Matches
    the `hash.fake()` precedent from 0.66.0.
  - Also `signStorageUrl` / `verifyStorageUrl` / `contentTypeFor` for signing any
    URL yourself, and an S3/R2 presigning disk recipe in the
    [storage guide](https://keeljs.com/docs/storage).

- **Events: a typed registry, error isolation, and fakes.**
  - **The `EventsList` registry.** Declare an event's payload once via module
    augmentation and *both* sides are checked — the value you `emit` and the one
    your listener receives can no longer drift apart. Opt-in and incremental: an
    undeclared event behaves exactly as before.
  - **`onError(handler)`** — route listener failures to one handler (with the
    event name and payload) instead of letting them reject `emit`.
  - **`onAny(listener)`** — observe every event, for logging and metrics.
  - **`fake()` / `restore()`** returning an `EventBuffer` with `assertEmitted`
    (optionally payload-matching), `assertNotEmitted`, `assertEmittedCount`,
    `assertNoneEmitted`, `all()`, and `payloadsFor()` — assert an event fired
    without triggering its side effects.
  - **`clearAll()`** — drop listeners, any-listeners, and the error handler.

- **Health checks.** New [health guide](https://keeljs.com/docs/health) and
  `healthCheck()` middleware serving the two endpoints an orchestrator actually
  asks about: `/health/live` (answers instantly, checks **nothing** — a liveness
  probe that touched the database would get a healthy app restarted during a
  database blip) and `/health/ready` (runs every registered check; **200** while
  healthy, **503** when one fails, which evicts the instance without killing it).
  `health().register([...])`, `Result.ok/warning/failed` (a warning is still
  healthy), `withMeta()`, `cacheFor(seconds)` so a frequent probe doesn't hammer
  what it's probing, `check(name, fn)` and `BaseCheck` for your own, and built-in
  `DatabaseCheck` / `RedisCheck` / `CacheCheck`. A check that throws becomes a
  failed result rather than taking down the report.

  Deliberately **absent**: disk-space, heap, and RSS checks. They measure a Node
  process, and on Workers there isn't one.

### Changed

- **A throwing event listener no longer skips the listeners after it.** `emit()`
  now runs *every* listener and reports failures afterwards — rejecting with the
  error, or with an `AggregateError` if several failed, or handing them to
  `onError()` if one is registered. Previously the first failure aborted the loop,
  so an analytics listener blowing up could silently cancel the welcome email.
  Failures are still never swallowed.

[0.68.0]: https://github.com/shaferllc/keel/releases/tag/v0.68.0

## [0.67.0] — 2026-07-11

### Added

- **Cache resilience & invalidation.** Stayed inside keel's single-store,
  edge-native model:
  - **Stampede protection.** `remember()` / `rememberForever()` now collapse
    concurrent misses for the same key into a **single** factory run, sharing the
    result — a hot key expiring no longer dog-piles the upstream. Per-isolate (no
    cross-node lock), which is where the dog-pile actually melts a server.
  - **Grace / stale-on-error.** `remember(key, ttl, factory, { grace })` retains
    an expired value `grace` seconds longer and serves it if the refreshing
    factory **throws** — a flaky upstream degrades to slightly-stale data instead
    of an error. A plain `get()` still reports the expired key as a miss, so stale
    values never leak through the read path.
  - **Tags & `deleteByTag`.** Tag entries via a `{ tags }` option on
    `put`/`add`/`remember`/`rememberForever`, then invalidate a whole group with
    `deleteByTag(["posts"])`. Uses version-stamp invalidation (a per-tag counter
    entries record and `deleteByTag` bumps), so it's O(number of tags) with no key
    index and works on any `CacheStore`. Tag-dropped entries are a hard miss (not
    grace-eligible).
  - **Namespaces.** `cache().namespace("users")` scopes keys under a `users:`
    prefix (so namespaces can reuse logical keys) and its `flush()` clears **only**
    that namespace via the same version-stamp mechanism. Namespaces nest and carry
    the full API.
  - **`add(key, value, ttl?)`** — write only if absent, returns whether it wrote.
  - **`missing(key)`** — the inverse of `has`.
  - **`forgetMany(keys)`** — delete several keys at once.
  - New `RememberOptions` and `PutOptions` types.

  Values are now stored in an internal envelope (value + logical expiry + tag
  stamps) so the cache can distinguish fresh from grace-retained or
  tag-invalidated; this is transparent through the `Cache` API and JSON-safe for
  the Redis store. Existing `get`/`put`/`has`/`pull`/`remember` behavior is
  unchanged, and the pluggable `CacheStore` contract is untouched. Intentionally
  **not** matched from bentocache: multi-tier L1/L2 + bus (multi-node sync),
  soft/hard timeouts, and the DynamoDB/database/file drivers — larger features
  that cut against keel's single-store simplicity.

[0.67.0]: https://github.com/shaferllc/keel/releases/tag/v0.67.0

## [0.66.0] — 2026-07-11

### Added

- **`hash.fake()` / `hash.restore()`.** Swap real PBKDF2 for a trivial, insecure
  scheme in tests so a suite that creates many users doesn't pay the (deliberate)
  hashing cost — `make` returns `fake$<password>` and `verify` just compares.
  Never for use outside tests.

[0.66.0]: https://github.com/shaferllc/keel/releases/tag/v0.66.0

## [0.65.0] — 2026-07-11

### Added

- **Security middleware suite.** Hashing and encryption already existed; this adds
  the rest — all edge-native:
  - **`cors()`** — Cross-Origin Resource Sharing with automatic preflight
    handling. `origin` as boolean / `"*"` / allowlist / predicate, plus
    `methods`, `headers`, `exposeHeaders`, `credentials` (auto-downgrades `"*"`
    to the concrete origin), and `maxAge`. New [CORS](https://keeljs.com/docs/cors)
    guide.
  - **`securityHeaders()`** — the SSR "shield": Content-Security-Policy (string or
    a camelCase directives object), HSTS, `X-Frame-Options`, `X-Content-Type-Options:
    nosniff`, and `Referrer-Policy`, each individually toggleable.
  - **`csrf()`** — session-backed CSRF protection; rejects unsafe requests without
    a valid token (`419`), with `csrfField()` / `csrfToken()` helpers, an
    `XSRF-TOKEN` cookie for SPAs, and route exemptions. New
    [Securing SSR apps](https://keeljs.com/docs/security) guide.

- **Container & provider lifecycle.** Container services already existed as the
  global helpers in [`helpers.ts`](https://keeljs.com/docs/container); this fills
  in the rest:
  - **Provider `ready()` and `shutdown()` hooks.** Providers grew two optional
    lifecycle methods beyond `register()`/`boot()`: `ready()` runs once the whole
    app is up (after every provider's `boot()` and the app's `onReady` hooks), and
    `shutdown()` runs on `app.terminate()` in reverse registration order (LIFO).
    Both are optional, so plain duck-typed providers keep working.
  - **`Container.swap(token, factory)` / `restore(token?)`.** Temporarily replace a
    binding with a fake for tests — the original binding and any resolved instance
    are remembered; `restore()` with no token undoes every swap. Also as the
    `swap` / `restore` global helpers.
  - **`Container.alias(alias, target)`.** Point a token at another so
    `make("router")` resolves through to `make(Router)`, honoring the target's own
    sharing. Also as the `alias` global helper.
  - **Graceful shutdown is now wired.** `keel serve` traps SIGINT/SIGTERM, stops
    accepting connections, and runs `app.terminate()` (and thus every provider's
    `shutdown()`) before exiting — the `onShutdown`/`terminate()` machinery
    existed but nothing triggered it.

  All additive and backward compatible. `@inject`-style reflective constructor
  injection and contextual bindings were intentionally left out — Keel's DI is by
  convention (a provider/controller constructor receives the container), which
  keeps the core free of `reflect-metadata` and edge-native.

### Changed

- **`encryption.encrypt(value, { expiresIn, purpose })`** — encrypted values can
  now self-expire and be bound to a purpose (e.g. `"password-reset"`), verified on
  `decrypt(token, { purpose })`; a wrong/absent purpose or an expired token returns
  `null`. Backward compatible — tokens made without options decrypt as before.
- **`rateLimiter`** now also emits the `X-RateLimit-Reset` header.

[0.65.0]: https://github.com/shaferllc/keel/releases/tag/v0.65.0

## [0.64.0] — 2026-07-11

### Added

- **OAuth 1.0a social sign-in.** Social auth grew a second flow for the older,
  three-legged providers (Twitter/X, and any OAuth 1.0a API). Every request is
  HMAC-SHA1-signed with Web Crypto, so it's edge-native like the OAuth2 side:
  - `social.twitter(config)` preset, and `social.driver1(spec, config)` /
    `oauth1Driver` for any OAuth 1.0a provider.
  - `OAuth1Driver` — `requestToken()` → `redirect()` → `accessToken()` /
    `user()`, plus a signed `get()` for profile calls. Returns the same
    normalized `SocialUser` (its `token` is an `OAuth1Token`).
  - `oauth1Signature()` — the low-level RFC 5849 HMAC-SHA1 signer, exposed for
    signing arbitrary provider API requests (verified against the canonical
    Twitter test vector).
  - New types `OAuth1Config`, `OAuth1Token`, `OAuth1ProviderSpec`; `SocialUser`
    is now generic over its token type. Documented in the
    [Social authentication](https://keeljs.com/docs/social-auth) guide.

  Additive and backward compatible — the OAuth2 presets are unchanged.

[0.64.0]: https://github.com/shaferllc/keel/releases/tag/v0.64.0

## [0.63.0] — 2026-07-11

### Added

- **A full authentication system.** Session and JWT already existed; this adds the
  rest, all edge-native (Web Crypto + `fetch`, no native deps):
  - **Opaque access tokens** (`tokens.ts`) — revocable, ability-scoped, DB-backed
    bearer tokens, the stateful counterpart to `jwt`. `createToken(userId, {
    abilities, expiresIn, name })` mints a `keel_<selector>.<verifier>` token
    (plaintext shown once); `verifyToken`, `revokeToken`, `revokeTokens` (log out
    everywhere), `listTokens`, `tokenAllows`/`tokenDenies`, `setTokensTable`. The
    split selector/verifier design stores only a SHA-256 hash and needs no
    `RETURNING`, so it's portable across every driver and a leaked DB can't mint
    tokens. Expired tokens self-prune on use.
  - **`tokenAuth(options?)`** guard — verifies an opaque `Bearer` token, sets the
    authenticated user, enforces required `abilities`, and exposes the token via
    `token()` / `tokenCan()`.
  - **`basicAuth(verify, options?)`** guard — HTTP Basic auth with a
    `WWW-Authenticate` challenge; the verifier returns a user id, `true`, or a
    falsy value.
  - **Social sign-in** (`social.ts`) — OAuth 2.0 "sign in with…", `fetch`-based
    with GitHub/Google/Discord presets and `social.driver()` for any other
    provider. Returns a normalized `SocialUser`; `redirect()`, `exchangeCode()`,
    `userFromToken()`, `user()`, `oauthState()` for CSRF, `OAuthError`. Keel owns
    the OAuth dance only — you find-or-create your user and log them in. New
    [Social authentication](https://keeljs.com/docs/social-auth) guide.
  - **Timing-safe credentials** — `hash.dummy`, a valid hash that never matches,
    so verifying a missing user costs the same as a wrong password (closes the
    email-enumeration timing leak).
  - **`gateAfter(callback)`** — the after-hook counterpart to `gateBefore`,
    completing authorization parity (audit or veto a decision after it's made).

  All additive and backward compatible. The `Auth` session guard, `jwt` +
  `bearerAuth`, and gates/policies are unchanged.

[0.63.0]: https://github.com/shaferllc/keel/releases/tag/v0.63.0

## [0.62.0] — 2026-07-11

### Added

- **Proxy-aware URL accessors on `request`.** `request.protocol`,
  `request.secure`, `request.host`, `request.hostname`, `request.origin`,
  `request.fullUrl`, and `request.querystring` introspect the request URL and
  connection. They honor `X-Forwarded-Proto` / `X-Forwarded-Host` over the raw
  URL, so an app behind a TLS-terminating proxy or load balancer sees the
  client's real scheme and host — use `origin` to build absolute links and
  `secure` to gate insecure requests. (Koa-inspired.)
- **`response.back(fallback?)` and `redirect("back")`.** Redirect to the
  request's `Referer`, falling back to `fallback` (default `"/"`) when it's
  absent — the "return where you came from" shortcut for post-form flows.
- **`response.attachment(filename?)`.** Marks the response as a downloadable
  attachment via `Content-Disposition`, emitting both a quoted ASCII `filename`
  and an RFC 5987 `filename*` so non-ASCII names survive. Chainable, so pair it
  with `type()`.
- **Encoding & charset negotiation.** `request.encoding(encodings)` /
  `request.encodings()` and `request.charset(charsets)` / `request.charsets()`
  complete the content-negotiation set alongside the existing `accepts` and
  `language` helpers, using the same q-weight and `*` rules.

## [0.61.0] — 2026-07-11

### Added

- **Batteries-included database adapters.** Ready-made `Connection` implementations
  for the common drivers, so you no longer hand-write the `select`/`write` bridge.
  Each ships as an optional subpath import and takes your driver instance:
  - `@shaferllc/keel/db/d1` — `d1Connection(env.DB)` for Cloudflare D1 (sqlite).
  - `@shaferllc/keel/db/pg` — `pgConnection(client)` for any node-postgres-compatible
    client: `pg` on Node or `@neondatabase/serverless` on the edge (postgres).
  - `@shaferllc/keel/db/libsql` — `libsqlConnection(client)` for `@libsql/client` /
    Turso, on Node and the edge (sqlite).

  Each adapter **duck-types its driver** (a minimal structural interface) and
  imports no driver — so Keel's core stays dependency-free and nothing is bundled
  until you import an adapter, and you install only the driver you use (a peer, not
  a Keel dependency). D1 and libSQL return the last insert id natively; Postgres
  needs a `RETURNING id` clause for `insertGetId()`.

[0.61.0]: https://github.com/shaferllc/keel/releases/tag/v0.61.0

## [0.60.0] — 2026-07-11

### Added

- **Multiple database connections.** The database layer grew from a single global
  connection to a named registry, so an app can talk to several databases at once
  — a Postgres primary and a SQLite/D1 cache, a separate reporting warehouse, a
  per-tenant shard — each with its own dialect. Inspired by the common API behind
  the [Feathers database adapters](https://feathersjs.com/api/databases/adapters.html)
  (register many, route per resource), but kept in Keel's driver-agnostic,
  edge-safe `Connection` model (still no bundled driver):
  - `addConnection(name, conn, dialect?)` registers a named connection alongside
    the default; `setConnection` still registers the default (unchanged).
  - `db(table, connectionName?)` routes a single query to a named connection.
  - `connection(name?)` returns a `ConnectionHandle` — `table()` plus a raw,
    dialect-adjusted `select`/`write` bridge.
  - `Model.connection` (a `static`) puts a whole model — reads, writes, and
    relations — on a chosen connection.
  - `setDefaultConnection(name)` switches the default; `connectionNames()` lists
    the registered ones; `clearConnections()` resets (test helper).
  - New type `ConnectionHandle`.

  Fully backward compatible: `setConnection` + `db(table)` behave exactly as
  before (the unnamed default lives under `"default"`), and connection resolution
  stays lazy — building a query never throws, only running one does.

[0.60.0]: https://github.com/shaferllc/keel/releases/tag/v0.60.0

## [0.59.0] — 2026-07-11

### Added

- **Stateless token authentication (JWT + bearer guard).** Took the token half of
  the [Feathers authentication API](https://feathersjs.com/api/authentication/)
  ([service](https://feathersjs.com/api/authentication/service.html),
  [JWT](https://feathersjs.com/api/authentication/jwt.html),
  [hook](https://feathersjs.com/api/authentication/hook.html)) — the piece Keel
  was missing next to its session/cookie `Auth` — and built it edge-native:
  - **`jwt`** — HS256 sign/verify on the Web Crypto API (no `jsonwebtoken`, no
    native bindings), signed with `config('app.key')`. `jwt.sign(payload, opts?)`
    stamps `iat` and (with `expiresIn`) `exp`, and supports `subject`/`issuer`/
    `audience`/`secret`; `jwt.verify()` returns the payload or `null` for a
    malformed, tampered, expired, not-yet-valid, or wrong-issuer/audience token.
    Only HS256 is accepted — `alg: none` and asymmetric algs are refused, closing
    the JWT algorithm-confusion hole. New types `JwtPayload`, `JwtSignOptions`,
    `JwtVerifyOptions`.
  - **`bearerAuth(options?)`** — a guard middleware that reads `Authorization:
    Bearer <token>`, verifies it, and makes the token's `sub` the authenticated
    id, so `auth().user()` resolves through the registered provider exactly as
    with sessions. Needs no session store (ideal on Workers). `{ optional: true }`
    lets unauthenticated requests through.
  - **`auth().id()`** now honors a `bearerAuth()` token (it wins over the session)
    and reads the request context directly, so token-only APIs work without
    `sessionMiddleware()`.

  Username/password login is unchanged — `hash` + `auth().login()` already cover
  the local flow. OAuth remains out of scope. All additive and backward compatible.

[0.59.0]: https://github.com/shaferllc/keel/releases/tag/v0.59.0

## [0.58.0] — 2026-07-11

### Added

- **Errors: the full HTTP exception family.** Rounded out the built-in exceptions
  against the [Feathers errors API](https://feathersjs.com/api/errors.html) — the
  set now covers every common status, each with a fixed `status` and a stable
  machine `code`: `BadRequestException` (400), `PaymentRequiredException` (402),
  `MethodNotAllowedException` (405), `NotAcceptableException` (406),
  `RequestTimeoutException` (408), `ConflictException` (409),
  `LengthRequiredException` (411), `TooManyRequestsException` (429),
  `ServerErrorException` (500), `NotImplementedException` (501),
  `BadGatewayException` (502), and `ServiceUnavailableException` (503) — joining
  the existing `NotFoundException`, `UnauthorizedException`, `ForbiddenException`,
  and `ValidationException`. `STATUS_TEXT` gained labels for the new statuses.
- **Structured error data.** `HttpException` gained an optional `data` bag
  (`new ConflictException(message, data)`) that surfaces in the JSON error body
  under `data`, plus a `toJSON()` returning the exact rendered body shape
  (`{ error, status, code?, data? }`, and `errors` for `ValidationException`) so
  an exception can be serialized outside the HTTP kernel.

  All additive and backward compatible.

[0.58.0]: https://github.com/shaferllc/keel/releases/tag/v0.58.0

## [0.57.0] — 2026-07-11

### Added

- **Application object: Feathers-style ergonomics.** Adopted the useful parts of
  the [Feathers Application API](https://feathersjs.com/api/application.html)
  onto `Application`, all additive:
  - `app.configure(fn)` — run a `(app) => unknown` configurator and chain. The
    one-shot inline alternative to a `ServiceProvider` (no register/boot split).
  - `app.set(key, value)` / `app.get(key, fallback?)` — app-wide settings store,
    backed by `Config` so `app.set` and `config().get` share one store.
  - `app.on` / `app.once` / `app.off` / `app.emit` — app-level events delegating
    to the `Events` singleton (same emitter as the global `listen()` helper).
  - New exported type `Configurator`.

  All backward compatible. `app.listen`/`teardown` map to Keel's existing
  Hono adapter + `boot()`/`terminate()`; the registry (`use`/`service`) is
  Keel's [container](https://keeljs.com/docs/container) + service broker.

[0.57.0]: https://github.com/shaferllc/keel/releases/tag/v0.57.0

## [0.56.0] — 2026-07-11

### Added

- **Service broker: params validation & result caching.** Six more Moleculer pages
  checked ([validating](https://moleculer.services/docs/0.15/validating),
  [caching](https://moleculer.services/docs/0.15/caching),
  [metrics](https://moleculer.services/docs/0.15/metrics),
  [tracing](https://moleculer.services/docs/0.15/tracing),
  [errors](https://moleculer.services/docs/0.15/errors),
  [runner](https://moleculer.services/docs/0.15/runner)):
  - **Validating** — an action's `params` schema is validated (and coerced) before
    the handler; a bad call rejects with `ValidationException`. Bring your own
    Zod-style schema.
  - **Caching** — mark an action `cache: true | { ttl, keys }` and give the broker
    a `cacher` (any Keel `Cache` — memory or Redis); results memoize by action +
    params (`keys` limits the key). No cacher → no-op.
  - **Metrics / tracing** — the middleware `localAction` seam is the hook; the
    trace context (`requestID`/`parentID`/`level`/`caller`) is already on every
    ctx. **Errors** — typed broker errors exist plus `createError`. **Runner** —
    `createService()` + `broker.start()` from boot. All documented rather than added.

  All additive and backward compatible.

[0.56.0]: https://github.com/shaferllc/keel/releases/tag/v0.56.0

## [0.55.0] — 2026-07-11

### Added

- **Service broker: fault tolerance & registry introspection.** Two more Moleculer
  pages checked ([fault-tolerance](https://moleculer.services/docs/0.15/fault-tolerance),
  [registry](https://moleculer.services/docs/0.15/registry)):
  - **Retry** — `call(action, params, { retries: 3 })` re-runs the whole call on
    failure (total attempts = retries + 1); `BrokerOptions.retries` sets a default.
  - **Fallback** — `{ fallback: value }` or `{ fallback: (err, ctx) => value }`
    returns instead of throwing once every attempt (and `error` hooks) fails.
    Order: retry → error hooks → fallback → throw. (Timeout was already present.)
  - **Registry introspection** — `broker.hasAction(name)`, `listActions()`,
    `listServices()`, `getService(name)`.
  - **Networking / balancing** — clustering is the `Transporter` seam (NATS/Redis/
    TCP); single-node has one endpoint per action, so cross-node balancing doesn't
    apply — event **group** balancing already works via `emit(…, { groups })`.
    Documented rather than added.

  All additive and backward compatible.

[0.55.0]: https://github.com/shaferllc/keel/releases/tag/v0.55.0

## [0.54.0] — 2026-07-11

### Added

- **Service broker: Moleculer-parity events & context.** A second parity pass over
  the broker, drawn from Moleculer's
  [events](https://moleculer.services/docs/0.15/events) and
  [context](https://moleculer.services/docs/0.15/context) pages:
  - **`broadcastLocal`** — broadcast to every listener on this node (mirrors
    `broadcast` until a real transporter would relay across nodes).
  - **Event groups & patterns** — the Events docs now spell out group-based
    balancing (`emit(..., { groups })`), and subscription keys gain the `?`
    single-char wildcard alongside `*` / `**`.
  - **Internal events** — the broker now emits `$broker.started`,
    `$broker.stopped`, and `$services.changed` (`{ service }` payload) that any
    service can subscribe to.
  - **Event context** — event handlers receive `ctx.eventName`, `ctx.eventType`
    (`"emit"` / `"broadcast"`), and `ctx.eventGroups`.
  - **Request-tree context** — every context now carries `ctx.parentID`,
    `ctx.level` (depth from 1), `ctx.caller` (invoking service), and `ctx.action`;
    `ctx.toJSON()` returns a log-safe snapshot with no functions or live refs.
  - **Broker middlewares** (Moleculer's
    [middlewares](https://moleculer.services/docs/0.15/middlewares)) — pass
    `middlewares: [...]` to wrap every action call and tap broker lifecycle. A
    middleware's `localAction(next, action)` wraps the handler (they compose,
    first = outermost); `started(broker)` / `stopped(broker)` run during
    `broker.start()` / `stop()`. (Service **lifecycle** hooks and per-service
    **`this.logger`** were already in place — the other two pages checked.)

  All additive and backward compatible.

[0.54.0]: https://github.com/shaferllc/keel/releases/tag/v0.54.0

## [0.53.0] — 2026-07-11

### Added

- **Route config / metadata.** Attach arbitrary data to a route or group with
  `.config({ … })` and read it in the handler or route middleware via
  `request.route.config` — per-route flags like an auth scope, rate tier, or
  layout choice (Fastify's route `config`). Group config merges into every route,
  with a route's own keys winning. The matched-route context is now set *before*
  a route's middleware, so route/group middleware can branch on `request.route`.
  See [docs/routing.md](./docs/routing.md#route-config).

[0.53.0]: https://github.com/shaferllc/keel/releases/tag/v0.53.0

## [0.52.0] — 2026-07-11

### Added

- **Service broker: Moleculer-parity actions & services.** The
  [broker](./docs/broker.md) grows the pieces a service-oriented app leans on,
  drawn from Moleculer's [services](https://moleculer.services/docs/0.15/services)
  and [actions](https://moleculer.services/docs/0.15/actions) pages:
  - **Full action definitions** — an action may now be `{ handler, visibility,
    timeout, hooks }` instead of only a bare handler.
  - **Action hooks** — `before` / `after` / `error` at the service level (keyed by
    action name, with `*`, `"a|b"`, and glob matching) or inline per action, run
    in Moleculer's order (before: wildcard → named → action; after/error reversed).
  - **Visibility** — `published` / `public` / `protected` / `private`; `private`
    actions are hidden from `call` but reachable internally via `this.actions.x`.
  - **`mcall`** — batch calls as an array or keyed map, with `settled` for
    per-call `{ status, value | reason }`.
  - **Mixins** — reusable schemas merged by type (settings/metadata deep-merge,
    actions/events/methods/hooks by key, lifecycle hooks chained), with a
    `merged()` hook; the service's own schema wins on conflict.
  - **Dependencies** — `dependencies` gates a service's `started` hook on other
    services being registered; `broker.waitForServices()` / `this.waitForServices()`
    wait explicitly.
  - **Richer context** — `ctx.locals` (per-call scratch), `ctx.headers` (transient,
    not propagated), and `ctx.requestID` (correlation id threaded through the
    request tree); `metadata` on the service instance; event listeners may declare
    a `group` that `emit`'s `groups` option targets.

  All additive and backward compatible — a bare-handler action, function-shorthand
  event, and hook-less service behave exactly as before.

[0.52.0]: https://github.com/shaferllc/keel/releases/tag/v0.52.0

## [0.51.0] — 2026-07-11

### Added

- **Response header helpers.** The `response` accessor gains `headers({...})` (set
  several at once), `getHeader(name)`, and `hasHeader(name)` — so middleware can
  inspect and conditionally set what a handler already put on the response (e.g.
  a default `cache-control`). Brings `response` to parity with Fastify's Reply.
  See [docs/request-response.md](./docs/request-response.md).
- **Design principles** documented in
  [docs/architecture.md](./docs/architecture.md#design-principles) — edge-safe /
  driver-agnostic and explicit-over-implicit spelled out alongside the existing
  container-first and thin-over-clever tenets.

[0.51.0]: https://github.com/shaferllc/keel/releases/tag/v0.51.0

## [0.50.0] — 2026-07-11

### Added

- **Parameterized providers.** Service providers — Keel's plugin system — now take
  options at registration: `app.register(RateLimitProvider, { max: 100 })`, typed
  via `ServiceProvider<{ max: number }>` and read as `this.options`. The same
  provider class can register more than once with different options, so a provider
  is now genuinely reusable (Fastify's `register(plugin, options)`). Backward
  compatible — options default to `{}`. (Keel providers stay un-encapsulated by
  design; per-request scoping is [middleware](./docs/middleware.md).) See
  [docs/providers.md](./docs/providers.md#providers-are-keels-plugin-system).

[0.50.0]: https://github.com/shaferllc/keel/releases/tag/v0.50.0

## [0.49.0] — 2026-07-11

### Added

- **Broadcasting.** Push events to clients in real time over named channels on a
  pluggable `Broadcaster` — the core owns no socket, so point it at Pusher/Ably
  (`fetch`), a Cloudflare Durable Object, or the built-in `MemoryBroadcaster`
  (in-process fan-out, for tests). `broadcast(channels, event, payload)`
  publishes; `channelAuth("orders.{id}", (user, params) => …)` gates private and
  presence channels (return `false`/`true`/member-data), resolved by
  `authorizeChannel` at your socket endpoint — composing with `auth()` and
  authorization. `MemoryBroadcaster.subscribe()` fans out in-process (Durable
  Object / SSE). See [docs/broadcasting.md](./docs/broadcasting.md).

[0.49.0]: https://github.com/shaferllc/keel/releases/tag/v0.49.0

## [0.48.0] — 2026-07-11

### Added

- **Task scheduling.** Declare recurring work with a fluent cadence — `schedule(new
  PruneSessions()).daily()`, `schedule(() => sync()).everyFiveMinutes()`,
  `schedule(job).cron("0 9 * * 1")` — then run the scheduler once a minute from a
  single trigger. Cadences: `everyMinute` … `everyThirtyMinutes`, `hourly` /
  `hourlyAt`, `daily` / `dailyAt("13:30")`, `weekly` / `monthly`, or any 5-field
  `cron()`. `scheduler().runDue(now)` runs everything due (to the minute); `due()`
  lists without running. Built-in cron matcher (`*`, lists, ranges, steps, and
  standard dom/dow semantics) — wire it to Cloudflare Cron Triggers'
  `scheduled()` handler or a Node interval. A task is a `Job` or a function. See
  [docs/scheduling.md](./docs/scheduling.md).

[0.48.0]: https://github.com/shaferllc/keel/releases/tag/v0.48.0

## [0.47.0] — 2026-07-11

### Added

- **File storage.** A driver-agnostic storage layer on a pluggable `Disk` — the
  core imports no filesystem or SDK, so it runs on Node and the edge.
  `setDisk(disk, name?)` then `storage(name?)`: `put` (string / bytes /
  ArrayBuffer) / `get` / `getText` / `exists` / `delete` / `list(prefix?)` /
  `url`. `MemoryDisk` is a full in-memory driver and the default, so `storage()`
  works in tests with no setup; point disks at the local filesystem (Node), S3
  (`fetch`), or a Cloudflare R2 binding (adapters in the docs). Register several
  disks by name and select with `storage("s3")`. See
  [docs/storage.md](./docs/storage.md).

[0.47.0]: https://github.com/shaferllc/keel/releases/tag/v0.47.0

## [0.46.0] — 2026-07-11

### Added

- **Authorization — gates & policies.** Where `auth()` is *who you are*, this is
  *what you're allowed to do*. `define(ability, (user, ...args) => …)` registers a
  gate; `policy(Model, PolicyClass)` groups abilities as methods on a plain class,
  and `can("update", post)` routes to `PostPolicy.update(user, post)` by the
  argument's class. `can` / `cannot` return booleans; `authorize` throws a `403`;
  `canFor` / `authorizeFor` check a specific user; `gateBefore` short-circuits
  every check (admin bypass). The current user resolves from `auth().user()` by
  default (overridable with `setUserResolver`); unknown abilities deny. See
  [docs/authorization.md](./docs/authorization.md).

[0.46.0]: https://github.com/shaferllc/keel/releases/tag/v0.46.0

## [0.45.0] — 2026-07-11

### Added

- **Test client.** `testClient(app)` injects requests into your app — no server,
  no port — and returns a `TestResponse` with verb helpers (`get` / `post` (JSON
  body) / `put` / `patch` / `delete`) and fluent, chainable assertions
  (`assertStatus` / `assertOk` / `assertJson` / `assertText` / `assertHeader` /
  `assertRedirect`). The response body is pre-buffered, so reads are synchronous
  and repeatable. Accepts an `Application`, an `HttpKernel` (to register global
  middleware first), or any `request()`-able. Edge-safe — the same fetch-style
  injection Keel's own suite uses, minus the boilerplate. See
  [docs/testing.md](./docs/testing.md).

[0.45.0]: https://github.com/shaferllc/keel/releases/tag/v0.45.0

## [0.44.0] — 2026-07-11

### Added

- **Declarative request validation.** `validateRequest({ body, query, params })`
  is middleware that validates the request *before* the handler runs — rejecting
  a bad request with a `422` `ValidationException` (errors from every part
  aggregated, keyed `body.field` / `query.field` / `params.field`) so the handler
  only ever sees valid input. `validated(part)` returns the parsed, typed value.
  The declarative counterpart to Fastify's route schemas, built on the same
  schema-agnostic `validate()` engine (bring your own Zod-style schema). See
  [docs/validation.md](./docs/validation.md#declarative-validation-before-the-handler).

[0.44.0]: https://github.com/shaferllc/keel/releases/tag/v0.44.0

## [0.43.0] — 2026-07-10

### Added

- **Per-request logging.** `requestLogger()` middleware binds a child logger with
  a generated `reqId` to each request, so every log line within a request
  correlates (Fastify's `request.log`). It logs request start/completion
  (method, path, status, ms) by default; options for `genReqId`, reusing an
  incoming `idHeader` (distributed tracing), and disabling the auto lines.
  `requestLog()` reaches the current request's logger anywhere (falls back to the
  base logger outside a request).
- **Log redaction.** `new Logger({ redact: ["password", "req.headers.authorization"] })`
  replaces matched values (top-level keys or dot paths) with `"[redacted]"`
  without mutating the logged object; inherited by child loggers. See
  [docs/logger.md](./docs/logger.md#per-request-logging).

[0.43.0]: https://github.com/shaferllc/keel/releases/tag/v0.43.0

## [0.42.0] — 2026-07-10

### Added

- **Application lifecycle hooks & graceful shutdown.** `onReady(hook)` runs after
  boot (or immediately if already booted); `onShutdown(hook)` registers cleanup
  and `terminate()` runs every shutdown hook newest-first (LIFO) — close DB/Redis
  connections, flush queues on `SIGTERM`. `terminate()` is idempotent and a
  throwing hook can't strand the rest (first error re-thrown after all run).
  `Router.onRoute(hook)` observes route registration (fired live and replayed for
  existing routes). Available as `Application` methods and global helpers.
  Request-lifecycle hooks remain [middleware](./docs/middleware.md). See
  [docs/hooks.md](./docs/hooks.md).

[0.42.0]: https://github.com/shaferllc/keel/releases/tag/v0.42.0

## [0.41.1] — 2026-07-10

### Added

- **Coded errors — `createError`.** Mint a reusable, coded `HttpException`
  subclass in one line: `createError("E_FUNDS", "Balance too low: need %s", 402)`.
  `%s` placeholders fill from the constructor arguments, the result renders
  through the default path (with `code` in the JSON body) and passes
  `instanceof HttpException`. The built-in exceptions now carry stable codes too
  (`E_NOT_FOUND`, `E_UNAUTHORIZED`, `E_FORBIDDEN`, `E_VALIDATION`), so `code`
  surfaces without any work. Inspired by Fastify's `@fastify/error`. Also
  documented: serving over **HTTP/2** needs no framework code — it's a transport
  concern handled by the edge platform, a reverse proxy, or a `@hono/node-server`
  `node:http2` option. See [docs/errors.md](./docs/errors.md#coded-errors-with-createerror)
  and [docs/hono.md](./docs/hono.md#serving-over-http2).

[0.41.1]: https://github.com/shaferllc/keel/releases/tag/v0.41.1

## [0.41.0] — 2026-07-10

### Added

- **Service Broker.** A Moleculer-style backbone for service-oriented code.
  Register services (a name plus `actions` and `events`) with a `Broker`, then
  reach them by string name: `broker().call("users.get", { id })` runs an action;
  `broker().emit("user.created", user)` fans an event out to every listener
  (balanced), or `broadcast` to all. Actions receive a `Context` and call other
  actions via `ctx.call`, threading `meta` (auth, trace ids) down through nested
  calls. Services support `version` prefixes (`v2.users.*`), `settings`, bound
  `methods`, glob event subscriptions (`user.*` / `user.**`), lifecycle hooks
  (`created` / `started` / `stopped`), and per-call `timeout`. Clustering lives
  behind a pluggable `Transporter` seam — the default `LocalTransporter` is a
  single-node no-op, so the core imports no network client and stays edge-safe.
  `broker()` / `setBroker()` manage the default instance, mirroring
  `redis()` / `setRedis()`. See [docs/broker.md](./docs/broker.md).

[0.41.0]: https://github.com/shaferllc/keel/releases/tag/v0.41.0

## [0.40.1] — 2026-07-10

### Added

- **Raw request-body accessors.** `request.text()`, `request.arrayBuffer()`, and
  `request.blob()` read the body for content types `json()` / `all()` don't
  handle — XML, CSV, protobuf, msgpack, or any custom format — which you then
  parse yourself. Keel keeps body parsing explicit (no Fastify-style content-type
  parser registry): you call the accessor you want. See
  [docs/request-response.md](./docs/request-response.md#other-content-types).

[0.40.1]: https://github.com/shaferllc/keel/releases/tag/v0.40.1

## [0.40.0] — 2026-07-10

### Added

- **Request decorators.** Attach named, computed values to the current request
  — `request.user` / `tenant` / `locale` — resolved lazily and memoized for the
  life of the request. `decorateRequest(name, resolver)` registers a resolver
  (sync or async), `decorated(name)` reads it (computed once, then cached),
  `setRequestValue(name, value)` sets it imperatively (e.g. from middleware), and
  `hasRequestDecorator(name)` checks. Inspired by Fastify's `decorateRequest`,
  but without the null-placeholder/`onRequest`-hook dance — the per-request memo
  is keyed off the context via a WeakMap, so nothing leaks between requests.
  (Decorating the *app* is already the container's job.) See
  [docs/decorators.md](./docs/decorators.md).

[0.40.0]: https://github.com/shaferllc/keel/releases/tag/v0.40.0

## [0.39.0] — 2026-07-10

### Added

- **Redis.** A Redis integration on a pluggable `RedisConnection` driver — the
  core imports no client, so it runs on Node and the edge. `setRedis(driver)`
  then `redis()`: `get` / `set` (with `{ ex }` / `{ px }` TTL) / `del` / `exists`
  / `incr` / `decr` / `expire` / `ttl` / `keys` / `flushAll`, plus `getJson` /
  `setJson` and a `remember` read-through cache. `MemoryRedis` is a full
  in-memory driver (TTL-aware) and the default, so `redis()` works in tests with
  no setup; point it at Upstash (`fetch`), ioredis, or node-redis in production.
  `redisStore()` adapts it into a `CacheStore` so the cache can be Redis-backed.
  See [docs/redis.md](./docs/redis.md).

[0.39.0]: https://github.com/shaferllc/keel/releases/tag/v0.39.0

## [0.38.0] — 2026-07-10

### Added

- **ORM maturity — timestamps.** `static timestamps = true` auto-manages
  `created_at` / `updated_at` (both on insert, only `updated_at` on update);
  column names are overridable via `createdAtColumn` / `updatedAtColumn`.
- **Pagination.** `Model.paginate(page, perPage)` and `db(table).paginate(...)`
  return a `Paginated<T>` — `{ data, total, perPage, currentPage, lastPage }`.
- **Aggregates & single values.** Query builder `sum` / `avg` / `min` / `max`,
  plus `value(column)` (one column of the first row) and `pluck(column)` (a
  column across all rows).
- **More query clauses.** `whereBetween`, `whereNotIn`, `whereLike`, and
  `latest()` / `oldest()` ordering by a timestamp column.
- **Find-or-create & convenience writes.** `Model.firstOrCreate(match, values)`,
  `Model.updateOrCreate(match, values)`, instance `update(attrs)` (fill + save),
  and `refresh()` (re-read the row). See [docs/models.md](./docs/models.md).
- **Full Vite support.** A first-class frontend build, the way modern full-stack
  frameworks do it. A `keelVite()` plugin (new `@shaferllc/keel/vite` entry) wires
  `vite.config.ts` — manifest, output, entrypoints, `base` — and writes a
  `public/hot` marker while the dev server runs; optional `reload` globs
  full-reload the browser on server-view changes. The `Vite` service renders the
  `<script>`/`<link>` tags for your entrypoints and resolves asset URLs, flipping
  automatically between the dev server (with HMR) and the hashed, preloaded
  production manifest. Helpers `viteTags` / `viteAsset` / `viteReactRefresh` slot
  straight into a JSX `<head>`; `scriptAttributes` / `styleAttributes`, a CDN
  `assetsUrl`, React Fast Refresh, and an edge-safe `useManifest` path are all
  covered. Tag generation is pure and runs on the edge. See
  [docs/vite.md](./docs/vite.md).

[0.38.0]: https://github.com/shaferllc/keel/releases/tag/v0.38.0

## [0.37.1] — 2026-07-10

### Fixed

- **`make:*` stubs import the resolvable specifier.** Generated files now import
  from `@shaferllc/keel/core` (the published entry point) instead of the internal
  `@keel/core` alias, so scaffolded code compiles in a real project.
- **`Connection.select` is no longer generic** — it returns `Promise<Row[]>`, so a
  driver implementation no longer needs an `as Connection` cast. `db<T>()` still
  types results (the builder casts internally).
- **`hash.verify` never throws.** A malformed hash (right prefix but a non-numeric
  iteration count or invalid base64) now returns `false` instead of throwing.
- **Sessions handle non-Latin1 values.** Cookie serialization is UTF-8-safe, so
  storing emoji or non-Latin text no longer crashes the response (`btoa` throw).
- **`router.url()` fills repeated params.** A `:param` appearing more than once in
  a path is now fully substituted, and won't match inside a longer param name.

[0.37.1]: https://github.com/shaferllc/keel/releases/tag/v0.37.1

## [0.37.0] — 2026-07-10

### Added

- **Transformers.** A presentation layer between your models and your JSON:
  subclass `Transformer<T>`, define one `transform()`, and get `item` /
  `collection` / `document`. `when(condition, value)` includes a field only when
  a condition holds — omitting the key entirely rather than leaking `null` — with
  a `mergeWhen` counterpart for groups of fields and thunks for deferred values.
  `whenLoaded(model, name, transformer)` embeds a relation only if it was
  eager-loaded, so a transformer never fires a surprise query. `document()` wraps
  the payload under a key (`data` by default) with top-level `meta`. Edge-safe;
  depends on nothing but the value you hand it. New generator
  `keel make:transformer`. See [docs/transformers.md](./docs/transformers.md).
- **Templates.** A string templating engine:
  `{{ }}` / `{{{ }}}` interpolation, `{{-- comments --}}`, and `@`-tags —
  `@if` / `@elseif` / `@else`, `@each` (with `$loop`), `@include` / `@includeIf`,
  `@set`, layouts (`@layout` / `@section` / `@yield`), components with slots
  (`@component` / `@slot`), filters (`{{ name | upper }}`), globals, and `@dump`.
  `templates().register(name, src)` then `render(name, state)`. Unlike engines
  that compile to a function, Keel *interprets* templates against a safe
  expression evaluator instead of `eval` / `new Function`, so the same templates
  run on Node and on Workers.
  See [docs/templates.md](./docs/templates.md).

[0.37.0]: https://github.com/shaferllc/keel/releases/tag/v0.37.0

## [0.36.0] — 2026-07-10

### Added

- **Notifications.** Send a message to one or many recipients over pluggable
  channels: `notify(user, new InvoicePaid(4200))`. A `Notification` declares
  `via()` (channels) and per-channel content (`toMail`, `toArray`). Built-in
  channels: `MailChannel` (via the mailer, routed by `email` or
  `routeNotificationFor`), `DatabaseChannel` (inserts `toArray` into a table),
  and `ArrayChannel` (for tests). Set `shouldQueue = true` to deliver from a
  queued job. This is where the mail and queue layers compose — a custom channel
  is one `send` method. New generator `keel make:notification`. See
  [docs/notifications.md](./docs/notifications.md).

[0.36.0]: https://github.com/shaferllc/keel/releases/tag/v0.36.0

## [0.35.0] — 2026-07-10

### Added

- **Queues & jobs.** Move slow work off the request path: `dispatch(new
  SendWelcome(id))` places a `Job` (or a plain function) on a queue, and a
  pluggable `QueueDriver` decides when it runs. Built-in drivers: `SyncDriver`
  (runs immediately — the default), `MemoryDriver` (defers; `work()` drains it
  FIFO, inspect `.jobs`). `dispatch` takes `{ delay, queue }` options; a custom
  `push`-only driver is the seam for a real broker (e.g. Cloudflare Queues).
  New generator `keel make:job`. Core imports no broker, edge-safe. See
  [docs/queues.md](./docs/queues.md).

[0.35.0]: https://github.com/shaferllc/keel/releases/tag/v0.35.0

## [0.34.0] — 2026-07-10

### Added

- **Mail.** A fluent, edge-safe mailer: `mail().to().subject().html().send()`,
  with a pluggable `Transport` (like the database `Connection`). Register a
  default with `setMailer(transport, { from })`. Built-in transports:
  `ArrayTransport` (collects to `.sent`, the default and ideal for tests),
  `LogTransport` (logs instead of delivering), and `fetchTransport({ url,
  headers, body })` for provider HTTP APIs (Resend/Postmark/Mailgun) over
  `fetch` — the core imports no SDK. `send()` validates recipient/subject/body/
  from. See [docs/mail.md](./docs/mail.md).

[0.34.0]: https://github.com/shaferllc/keel/releases/tag/v0.34.0

## [0.33.0] — 2026-07-10

### Added

- **Model attribute casts.** `static casts = { active: "boolean", meta: "json",
  joined_at: "date" }` round-trips columns as real JS types — cast when read
  (from the database or `fill`) and back to storable primitives on write. This
  is what lets `boolean`/`json` columns bind cleanly on drivers that reject JS
  booleans and objects. Types: `int`, `float`, `boolean`, `string`, `json` /
  `array`, `date`.
- **Mass-assignment guarding.** `static fillable` (allowlist) or `static
  guarded` (denylist) filter the attributes `create()` and `fill()` accept, so
  untrusted request data can't over-post protected columns. `forceFill()`
  bypasses it deliberately. With neither declared, behavior is unchanged
  (backward compatible). See [docs/models.md](./docs/models.md#attribute-casts).

[0.33.0]: https://github.com/shaferllc/keel/releases/tag/v0.33.0

## [0.32.0] — 2026-07-10

### Added

- **Factories & seeders.** `factory(Model, (f, i) => ({ ... }))` builds model
  attributes with a built-in, dependency-free `Faker` (names, emails, words,
  numbers, uuids — seedable for deterministic runs). Call `.make()` (unsaved) or
  `.create()` (persisted), `.count(n)` for batches, and override attributes
  inline. `Seeder` classes have a `run()` and can `call([OtherSeeder])` to
  compose; `seed(DatabaseSeeder)` runs one. New generators `keel make:factory`
  and `keel make:seeder`. Edge-safe (no external faker library). See
  [docs/factories.md](./docs/factories.md).

[0.32.0]: https://github.com/shaferllc/keel/releases/tag/v0.32.0

## [0.31.0] — 2026-07-10

### Added

- **Model relationships.** Define relationships as methods on your model:
  `hasMany` / `hasOne` / `belongsTo` / `belongsToMany`, with conventional
  foreign keys (`user_id`) you can override. Relations are awaitable
  (`await user.posts()`), expose `.query()` to drop to the builder, and
  `Model.load(models, "posts", "roles")` eager-loads with one `whereIn` per
  relation (fixes N+1). `belongsToMany` reads through a pivot table and offers
  `attach` / `detach` / `sync`. Loaded relations stay out of `save()` and
  serialize through `toJSON()`. Runs entirely on the query builder — no JOINs,
  edge-safe. See [docs/models.md](./docs/models.md#relationships).

[0.31.0]: https://github.com/shaferllc/keel/releases/tag/v0.31.0

## [0.30.0] — 2026-07-10

### Added

- **Migrations.** A fluent schema builder (`schema.createTable(name, t => { t.id();
  t.string("email").unique(); t.timestamps(); })`) and a `Migrator` that runs
  `{ name, up, down }` migrations against your connection, tracking applied ones
  in a `migrations` table (`up`/`down`/`ran`, batched). Dialect-aware SQL
  (sqlite/mysql/postgres). See [docs/migrations.md](./docs/migrations.md).

[0.30.0]: https://github.com/shaferllc/keel/releases/tag/v0.30.0

## [0.29.0] — 2026-07-10

### Added

- **Active-record `Model`.** Subclass `Model`, set a `table`, and get static
  `find` / `findOrFail` / `all` / `first` / `where` / `create` plus instance
  `save` (insert or update), `delete`, `fill`, and `toJSON`. Built on the query
  builder, so it runs on any registered connection (edge-safe). `Model.query()`
  drops to the raw builder for richer queries. See [docs/models.md](./docs/models.md).

[0.29.0]: https://github.com/shaferllc/keel/releases/tag/v0.29.0

## [0.28.0] — 2026-07-10

### Added

- **Database query builder.** A driver-agnostic, parameterized query builder:
  `db(table).where().orderBy().limit().get()/first()/count()/exists()`, plus
  `whereIn` / `whereNull` / `orWhere`, and `insert` / `insertGetId` / `update` /
  `delete`. Runs through a two-method `Connection` you register with
  `setConnection(conn, dialect)` — works with D1, Neon/Postgres, PlanetScale,
  Turso, better-sqlite3, `pg`. The core imports no driver (edge-safe). See
  [docs/database.md](./docs/database.md).

[0.28.0]: https://github.com/shaferllc/keel/releases/tag/v0.28.0

## [0.27.0] — 2026-07-10

### Added

- **Authentication.** Session-based auth: `auth().login(id)` / `logout()` /
  `check()` / `guest()` / `id()` / `user()`, a pluggable user provider via
  `setUserProvider()`, and an `authGuard({ redirectTo? })` middleware (401 or
  redirect). Built on the session + hash primitives. See
  [docs/authentication.md](./docs/authentication.md).

[0.27.0]: https://github.com/shaferllc/keel/releases/tag/v0.27.0

## [0.26.0] — 2026-07-10

### Added

- **Logger.** A leveled logger (`logger().debug/info/warn/error`) with structured
  JSON output (pretty in debug), a level threshold from `config('logger.level')`,
  and `logger().child({ … })` for bound fields. See [docs/logger.md](./docs/logger.md).

[0.26.0]: https://github.com/shaferllc/keel/releases/tag/v0.26.0

## [0.25.0] — 2026-07-10

### Added

- **Rate limiting.** `rateLimiter({ max, window, key, message })` — a fixed-window
  limiter middleware with per-key buckets (client IP by default), the standard
  `X-RateLimit-*` / `Retry-After` headers, and `429` on exceed. In-memory store
  (pluggable for distributed limiting). See [docs/rate-limiting.md](./docs/rate-limiting.md).

[0.25.0]: https://github.com/shaferllc/keel/releases/tag/v0.25.0

## [0.24.0] — 2026-07-10

### Added

- **Password hashing.** `hash.make(password)` (PBKDF2-SHA256, self-describing),
  `hash.verify(hashed, password)` (timing-safe), and `hash.needsRehash()`.
- **Value encryption.** `encryption.encrypt(value)` / `encryption.decrypt(token)`
  (AES-GCM, keyed by `config('app.key')`; `decrypt` returns `null` on tamper).
- Both use the Web Crypto API — edge-safe, no native bindings. See
  [docs/hashing.md](./docs/hashing.md).

[0.24.0]: https://github.com/shaferllc/keel/releases/tag/v0.24.0

## [0.23.0] — 2026-07-10

### Added

- **Debugging helpers.** `dump(...values)` prints to the console and returns its
  first argument (inline-friendly); `dd(...values)` dumps to the browser and
  halts the request via a self-rendering exception. Both edge-safe. See
  [docs/debugging.md](./docs/debugging.md).

[0.23.0]: https://github.com/shaferllc/keel/releases/tag/v0.23.0

## [0.22.0] — 2026-07-10

### Added

- **Self-handling & reportable exceptions.** An exception with a `handle(c)`
  method renders itself; one with a `report()` method has it called (and
  awaited) before rendering — for logging/metrics, without masking the error.
- **Error codes.** `HttpException` now carries an optional `code` (e.g.
  `E_UNAUTHORIZED`), included in the JSON error body. See
  [docs/errors.md](./docs/errors.md).

[0.22.0]: https://github.com/shaferllc/keel/releases/tag/v0.22.0

## [0.21.0] — 2026-07-10

### Added

- **URL builder.** `router.url(name, params, { qs })` now takes a query string.
- **Signed URLs.** `router.signedUrl(name, params, { qs, expiresIn })` produces a
  tamper-proof link (HMAC-SHA256 via Web Crypto, keyed by `config('app.key')`);
  `router.hasValidSignature()` verifies the current request. Edge-safe. See
  [docs/url-builder.md](./docs/url-builder.md).

[0.21.0]: https://github.com/shaferllc/keel/releases/tag/v0.21.0

## [0.20.0] — 2026-07-10

### Added

- **Named middleware registry.** `router.named({ auth, admin })` registers
  middleware by name; reference it with `.use("auth")` / `.middleware([...])` on
  routes, groups, and resources. Names resolve when the app builds (unknown
  names throw). Raw functions still work everywhere. See
  [docs/middleware.md](./docs/middleware.md).

[0.20.0]: https://github.com/shaferllc/keel/releases/tag/v0.20.0

## [0.19.0] — 2026-07-10

### Added

- **File uploads.** `request.file(name)`, `request.files(name)`, and
  `request.allFiles()` return web-standard `File` objects (edge-safe, no temp
  dir). The parsed `FormData` is cached per request, so file access and
  `request.all()` coexist.
- **Content negotiation.** `request.accepts([...])`, `request.types()`,
  `request.language([...])`, `request.languages()`.
- **Request meta.** `request.hasBody()`, `request.headers()`, `request.ips()`.
- **Response helpers.** `response.type(mime)`, `response.append(name, value)`,
  `response.removeHeader(name)`, and the guards `response.abortIf(cond, …)` /
  `response.abortUnless(cond, …)`.

[0.19.0]: https://github.com/shaferllc/keel/releases/tag/v0.19.0

## [0.18.0] — 2026-07-10

### Added

- **Static file server.** `serveStatic(options)` serves files from a directory
  (default `public/`) before your routes, with `ETag` / `Last-Modified` / `304`
  handling, `Cache-Control` (`maxAge` / `immutable`), a dot-file policy
  (`ignore` / `deny` / `allow`), per-file `headers()`, and path-traversal
  protection. `node:fs` is imported dynamically so the core still loads on the
  edge. See [docs/static-files.md](./docs/static-files.md).

[0.18.0]: https://github.com/shaferllc/keel/releases/tag/v0.18.0

## [0.17.0] — 2026-07-10

### Added

- **Cache.** A memory-backed cache with TTLs and the `remember` pattern:
  `cache().get/put/has/forget/pull/flush`, `cache().remember(key, ttl, fn)`, and
  `rememberForever`. Pluggable via the `CacheStore` interface (swap in Redis/KV).
  See [docs/cache.md](./docs/cache.md).

[0.17.0]: https://github.com/shaferllc/keel/releases/tag/v0.17.0

## [0.16.0] — 2026-07-10

### Added

- **Events.** A tiny event emitter for decoupling — `emit(event, payload)` and
  `listen(event, fn)` global helpers, plus `events()` for `once` / `off` /
  `listenerCount` / `clear`. Listeners may be async and are awaited in order.
  See [docs/events.md](./docs/events.md).

[0.16.0]: https://github.com/shaferllc/keel/releases/tag/v0.16.0

## [0.15.0] — 2026-07-10

### Added

- **Sessions.** A cookie-backed session store (edge-safe, no external service):
  `session().get/put/has/forget/pull/increment/clear/all`, plus **flash**
  messages (`session().flash()` / `session().flashed()`) that survive one
  request. Enable with `sessionMiddleware()` in your HTTP kernel. See
  [docs/sessions.md](./docs/sessions.md).

[0.15.0]: https://github.com/shaferllc/keel/releases/tag/v0.15.0

## [0.14.0] — 2026-07-10

### Added

- **Request input API.** `request.all()`, `request.input(key, fallback?)`,
  `request.only([...])`, `request.except([...])` (merge query + parsed body),
  plus `request.ip()`.
- **Cookies.** `request.cookie(name?)`, `response.cookie(name, value, options)`,
  and `response.clearCookie(name)`.
- **Response helpers.** `response.send(data)` (objects → JSON, else text) and
  `response.abort(message, status)` (throws an `HttpException`).
- See [docs/request-response.md](./docs/request-response.md).

[0.14.0]: https://github.com/shaferllc/keel/releases/tag/v0.14.0

## [0.13.0] — 2026-07-10

### Added

- **Single-action controllers.** `router.post("/publish", [PublishPost])` calls
  the controller's `handle` method.
- **Lazy-loaded controllers.** `[() => import("../Controllers/X.js"), "index"]`
  — the controller is imported only when its route is first hit.
- **Richer resources.** `RouteResource` gained `.as(name)`, `.params({ … })`,
  and `.use(actions, mw)`; `router.resource("posts.comments", C)` nests
  resources (`/posts/:post_id/comments/:id`).
- **`make:controller --resource`** generates a controller with all seven RESTful
  actions.
- See [docs/controllers.md](./docs/controllers.md).

[0.13.0]: https://github.com/shaferllc/keel/releases/tag/v0.13.0

## [0.12.0] — 2026-07-10

### Added

- **Inertia.js server adapter.** `inertia("Page", props)` and
  `router.on(path).renderInertia(...)` — full HTML on first load, JSON page
  object on XHR navigations, asset-version 409s, and partial reloads. Configure
  an `Inertia` instance (root view + version) in a provider. See
  [docs/inertia.md](./docs/inertia.md).
- **Domain / subdomain routing.** `route.domain(pattern)` and
  `group(...).domain(":tenant.example.com")`, dispatched by `Host`; subdomain
  params via `request.subdomain(name)`.
- **Route matchers & global constraints.** `router.matchers.number()/uuid()/slug()/alpha()`,
  a global `router.where(param, matcher)`, group `.where()`, and the `{ match }`
  matcher form.
- **Brisk-route helpers.** `on().renderInertia()`, `on().redirectToPath()`, and
  `on().redirectToRoute(name, params, { qs })`.
- **Current route.** `request.route` (`{ name, pattern, methods }`) and
  `request.routeIs(name)`.
- **`.use()`** middleware alias on routes and groups.

### Tests

- Suite grown to 45 tests; ~99% line coverage maintained.

[0.12.0]: https://github.com/shaferllc/keel/releases/tag/v0.12.0

## [0.11.0] — 2026-07-10

### Added

- **First-class routing.** The router gained a fluent API:
  - **Named routes** + `router.url(name, params)` for URL generation.
  - **Route groups** — `router.group(cb).prefix().middleware().as()`.
  - **Resource routes** — `router.resource(name, Controller)` with
    `.only()`/`.except()`/`.apiOnly()`.
  - **Per-route middleware** — `route.middleware([...])`.
  - **Param constraints** — `route.where("id", /\d+/)`.
  - **`router.on(path).redirect(to)` / `.render(Component)`** convenience routes.
  - **`router.any()`** and **`router.route(methods, path, handler)`**.
  - `keel routes` now lists verbs and route names.

### Changed

- `RouteDefinition.method` → `methods: Method[]` (routes can match multiple
  verbs); route defs also carry `name`, `middleware`, and `wheres`.

[0.11.0]: https://github.com/shaferllc/keel/releases/tag/v0.11.0

## [0.10.0] — 2026-07-10

### Added

- **Request validation.** `validate(schema, data?)` parses input (the JSON body
  by default) and returns typed data, or throws a `ValidationException` that the
  kernel renders as a 422 with per-field `errors`. Schema-agnostic — works with
  any Zod-style `safeParse` schema, so the framework doesn't bundle a validation
  library. See [docs/validation.md](./docs/validation.md).

[0.10.0]: https://github.com/shaferllc/keel/releases/tag/v0.10.0

## [0.9.0] — 2026-07-10

### Added

- **Static response routes.** Pass a ready-made response as a handler, no
  closure: `router.get("/health", json({ status: "ok" }))`. The router clones
  the response per request. (Dynamic responses that read the request still use a
  closure, since `param()` etc. run per request.)
- **`response` accessor.** Mirrors `request`: `response.json()`, `response.text()`,
  `response.html()`, `response.redirect()`, plus chainable `response.status(code)`
  and `response.header(name, value)`.

### Changed

- `json()`, `text()`, `html()`, and `redirect()` now work outside a request too
  (returning a plain `Response`), which is what makes static-response routes
  possible. Inside a handler they still build on the context.

[0.9.0]: https://github.com/shaferllc/keel/releases/tag/v0.9.0

## [0.8.0] — 2026-07-10

### Added

- **`request` accessor.** A flat view of the current request/response —
  `request.method`, `request.path`, `request.url`, `request.status`, plus
  `request.header()`, `request.param()`, `request.query()`, `request.json()`,
  and `request.raw`. Write `` `${request.method} ${request.path} → ${request.status}` ``
  in a logger without touching `c`.

### Changed

- `request` is now this accessor object rather than a function returning the raw
  Request; use `request.raw` for the underlying `Request`.

[0.8.0]: https://github.com/shaferllc/keel/releases/tag/v0.8.0

## [0.7.0] — 2026-07-10

### Added

- **Global container helpers.** `bind()`, `singleton()`, `instance()`,
  `make()`, and `bound()` operate on the active application, so you can register
  and resolve services from anywhere without `this.app` — e.g. `bind("clock",
  () => new Date())` and `make("clock")`. The `this.app.*` methods still work.

With this, Keel's whole surface is reachable as flat, easy-to-remember helpers:
`config` · `view` · `json`/`text`/`html`/`redirect` · `param`/`query`/`body` ·
`bind`/`singleton`/`instance`/`make` · `app`.

[0.7.0]: https://github.com/shaferllc/keel/releases/tag/v0.7.0

## [0.6.0] — 2026-07-10

### Added

- **Request & response helpers.** `json()`, `text()`, `html()`, `redirect()`,
  `param()`, `query()`, `header()`, `body()`, `request()`, and `ctx()` reach the
  current request without threading the context — write `json({ id: param("id") })`
  instead of `c.json({ id: c.req.param("id") })`. Backed by async-context storage
  the HTTP kernel enables per request. Taking `c` explicitly still works.

[0.6.0]: https://github.com/shaferllc/keel/releases/tag/v0.6.0

## [0.5.0] — 2026-07-10

### Added

- **Error & exception handling.** Throw `HttpException` (or `NotFoundException`,
  `UnauthorizedException`, `ForbiddenException`, `ValidationException`) anywhere
  and the HTTP kernel renders the right response — JSON or HTML by `Accept`, a
  readable stack-trace error page when `app.debug` is on, and hidden internals
  for unexpected 500s in production. Unmatched routes become a tidy 404.
  Customize via `kernel.onError(handler)` or by overriding `renderException`.
  See [docs/errors.md](./docs/errors.md).

[0.5.0]: https://github.com/shaferllc/keel/releases/tag/v0.5.0

## [0.4.0] — 2026-07-10

### Added

- **Global `view()` helper.** Render a view component in one call:
  `view(WelcomePage, { appName })` — props are type-checked against the
  component, and it returns a full HTML document. `view(HomePage)` works for
  components with no props. Sugar over the `View` service, matching `config()`.

[0.4.0]: https://github.com/shaferllc/keel/releases/tag/v0.4.0

## [0.3.0] — 2026-07-10

### Added

- **Global `config()` and `app()` helpers.** Read configuration from anywhere
  with `config("app.name")` / `config("app.port", 3000)` — no need to resolve
  the container by hand. `app()` returns the active application. Both resolve
  against the application registered automatically on construction.
- **Published as `@shaferllc/keel`.** The framework is now a proper npm package
  with a real build (compiled JS + `.d.ts` in `dist/`). Apps install it with
  `npm install @shaferllc/keel` and import from `@shaferllc/keel/core`, so they
  receive core updates through `npm update`.

### Changed

- Documentation and copy no longer describe Keel by comparison to other
  frameworks — it stands on its own.

[0.3.0]: https://github.com/shaferllc/keel/releases/tag/v0.3.0

## [0.2.0] — 2026-07-10

Views, and a core that runs on the edge.

### Added

- **View layer** — a `View` service that renders [Hono JSX](https://hono.dev)
  components to HTML. Views live in `resources/views/`; layouts are just
  components. Platform-neutral, so the same views run on Node and Cloudflare
  Workers. See [docs/views.md](./docs/views.md).
- **`keel/core` package export** — the framework core is now installable by
  other apps (`import { Application } from "keel/core"`). Only `src/core` ships
  in the published package.

### Changed

- **Workers-safe core** — `Application` no longer statically imports Node
  built-ins or dotenv; they're loaded dynamically only when filesystem config
  discovery runs. `boot(providers, { discoverConfig: false, config })` lets you
  configure inline on runtimes without a filesystem (e.g. Cloudflare Workers).

[0.2.0]: https://github.com/shaferllc/keel/releases/tag/v0.2.0

## [0.1.0] — 2026-07-10

The first release: the **MVP core**. Enough of a framework to build and serve a
real application.

### Added

- **Service container** — `bind` / `singleton` / `instance` / `make`, with
  string, symbol, and class tokens and auto-construction of unbound classes.
- **Application kernel** — loads `.env`, auto-loads `config/*.ts`, and runs the
  service-provider `register()` → `boot()` lifecycle.
- **Configuration** — dot-notation `Config` repository plus a type-coercing
  `env()` helper.
- **Service providers** — `ServiceProvider` base class and a `bootstrap`
  provider list.
- **Routing** — a `Router` facade over Hono; handlers may be closures or
  `[Controller, method]` tuples resolved from the container.
- **HTTP kernel** — global middleware stack that compiles routes onto Hono,
  served by `@hono/node-server`. Ships with a request-logging middleware.
- **Console (`keel`)** — `serve`, `routes`, and `make:controller`,
  `make:provider`, `make:middleware` generators with an overwrite guard.
- **Documentation** — getting started, container, providers, configuration,
  routing, middleware, console, and architecture guides.

[0.1.0]: https://github.com/shaferllc/keel/releases/tag/v0.1.0
