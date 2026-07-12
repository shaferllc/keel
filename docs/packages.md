# Packages

A **package** is a redistributable slice of a Keel app — routes, a UI, config,
migrations, console commands — that installs with a single `app.register(...)`.
Keel's `ServiceProvider` is already the unit of composition; `PackageProvider`
adds the conventions a *shippable* package needs so it can carry its own schema
and assets instead of asking the app to wire them by hand.

[Keel Watch](./watch.md) — the debug dashboard — is a first-party package and the
reference implementation of everything below. [Billing](./billing.md) (a Cashier
port for Stripe and Paddle) is another, and shows a package contributing models,
a schema migration, gateway drivers, and verified webhook routes.

## The shape of a package

```ts
import { PackageProvider, type Router } from "@shaferllc/keel/core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export class BillingServiceProvider extends PackageProvider {
  readonly name = "billing"; // used for publish grouping and diagnostics

  register(): void {
    this.mergeConfig("billing", { enabled: true, path: "billing" });
    this.migrations([createInvoicesTable]);
    this.publishes({ [join(here, "config.stub")]: "config/billing.ts" }, "billing-config");
    this.commands([syncInvoicesCommand]);
  }

  boot(): void {
    this.assets("billing/assets", join(here, "ui/dist"), { maxAge: 3600 });
    this.routes((r: Router) => registerBillingRoutes(r), { prefix: "billing", as: "billing" });
  }
}
```

Scaffold that skeleton with `keel make:package billing`.

## The helpers

Each is a thin wrapper over an existing Keel primitive — the value is the
convention, not new machinery.

| Helper | What it does |
|--------|--------------|
| `mergeConfig(key, defaults)` | Set config defaults under `key`. The app's `config/<key>.ts` deep-merges **over** them, so the app always wins. |
| `routes(register, { prefix, middleware, as })` | Register a route group (the callback gets the `Router`), already prefixed/guarded/name-prefixed. |
| `assets(urlPrefix, dir, { maxAge, immutable })` | Serve a directory of built files (a bundled UI) under a URL prefix. Node-only. |
| `migrations(list)` | Contribute migrations, run by `keel migrate` alongside the app's own. |
| `commands(list)` | Add `keel` console commands (e.g. `billing:sync`). |
| `publishes(map, tag?)` | Declare files a consuming app can copy in with `keel vendor:publish`. |

## Lifecycle: mind the kernel

`register()` and `boot()` run **before** the app's HTTP kernel is bound (see
`bootstrap/app.ts`). So a package must not reach for `HttpKernel`. That's why
`routes()` and `assets()` go through the `Router` (bound in the Application
constructor) — routes are compiled onto the kernel later, at build time. Use
`register()` for config/bindings and `boot()` for wiring; both are safe for the
helpers above.

## Migrations

Package migrations join the app's under one command:

```bash
keel migrate           # run pending (app + package) migrations
keel migrate:status    # show which have run
keel migrate:rollback  # roll back the last batch
```

App migrations are discovered from `database/migrations/*.ts` (each file
default-exports a `Migration` or `Migration[]`); package migrations come from
`this.migrations(...)`. Both run against the default connection.

## Publishing files

`publishes()` declares source→destination copies; `keel vendor:publish` performs
them (skipping files that already exist unless `--force`):

```bash
keel vendor:publish                     # everything
keel vendor:publish --tag billing-config # just one tagged group
```

This is how a package ships an overridable config stub, or copies a starter view
into the consuming app.

## Observing the framework

A package often wants to *see* what the app is doing — every query, request, or
job — without patching anything. The framework emits a typed **instrumentation
event stream** for exactly this; subscribe with `listen()`:

```ts
import { listen, type QueryEvent } from "@shaferllc/keel/core";

listen<QueryEvent>("db.query", (e) => metrics.timing("db", e.durationMs));
```

| Event | Fired when |
|-------|-----------|
| `db.query` | a query runs (sql, bindings, durationMs, connection, kind) |
| `request.handled` | a request finishes (method, path, status, durationMs, headers) |
| `exception` | an error reaches the HTTP kernel |
| `job.processing` / `job.processed` / `job.failed` | a queued job's lifecycle |
| `cache.hit` / `cache.miss` | a cache lookup |
| `notification.sent` | a notification is delivered |
| `schedule.task.run` | a scheduled task runs |
| `mail.sending` / `mail.sent` | mail lifecycle |

Every request opens a scope with a **request id** that flows through async work,
so anything emitted inside a request can attribute itself to it via
`currentRequestId()` — that's what lets [Watch](./watch.md) tie a request to the
queries and logs it produced. Emitting is fire-and-forget: a broken listener can
never break the work it observes.
```
