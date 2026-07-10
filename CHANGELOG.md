# Changelog

All notable changes to Keel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
