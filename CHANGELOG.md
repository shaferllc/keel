# Changelog

All notable changes to Keel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Full Vite support.** A first-class frontend build, the way Laravel and
  AdonisJS do it. A `keelVite()` plugin (new `@shaferllc/keel/vite` entry) wires
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
- **Templates.** A string templating engine in the spirit of Blade and Edge:
  `{{ }}` / `{{{ }}}` interpolation, `{{-- comments --}}`, and `@`-tags —
  `@if` / `@elseif` / `@else`, `@each` (with `$loop`), `@include` / `@includeIf`,
  `@set`, layouts (`@layout` / `@section` / `@yield`), components with slots
  (`@component` / `@slot`), filters (`{{ name | upper }}`), globals, and `@dump`.
  `templates().register(name, src)` then `render(name, state)`. Unlike Blade/Edge
  it *interprets* templates against a safe expression evaluator instead of
  `eval` / `new Function`, so the same templates run on Node and on Workers.
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
- **`.use()`** middleware alias on routes and groups (matches AdonisJS).

### Tests

- Suite grown to 45 tests; ~99% line coverage maintained.

[0.12.0]: https://github.com/shaferllc/keel/releases/tag/v0.12.0

## [0.11.0] — 2026-07-10

### Added

- **First-class routing.** The router gained a fluent, AdonisJS-inspired API:
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
