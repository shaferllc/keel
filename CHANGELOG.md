# Changelog

All notable changes to Keel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
