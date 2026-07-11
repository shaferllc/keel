# The Console

Keel ships with a console for running the server and generating code. The binary
is `bin/keel.ts`; npm scripts wrap it with `tsx`.

```bash
npm run keel <command> [args]
# e.g.
npm run keel routes
```

You can also invoke it directly: `npx tsx bin/keel.ts <command>`.

Every command boots the full application first — the same container, config, and
providers your HTTP requests get. The `serve` and `routes` commands use that
booted app; the `make:*` generators don't need it, they just stamp files onto
disk. Commands are wired up with [commander](https://github.com/tj/commander.js)
in [`src/core/cli/index.ts`](../src/core/cli/index.ts), and the code-generation
templates live in [`src/core/cli/stubs.ts`](../src/core/cli/stubs.ts).

## Command reference

| Command | Argument | Generates / does |
| --- | --- | --- |
| `serve` | `--port <n>` | Start the HTTP server |
| `routes` | — | List every registered route |
| `make:controller` | `<name>` `[-r]` | `app/Controllers/<Name>Controller.ts` |
| `make:provider` | `<name>` | `app/Providers/<Name>ServiceProvider.ts` |
| `make:middleware` | `<name>` | `app/Http/Middleware/<name>Middleware.ts` |
| `make:factory` | `<model>` | `database/factories/<Model>Factory.ts` |
| `make:seeder` | `<name>` | `database/seeders/<Name>Seeder.ts` |
| `make:job` | `<name>` | `app/Jobs/<Name>Job.ts` |
| `make:notification` | `<name>` | `app/Notifications/<Name>Notification.ts` |

Every generator normalizes the name you pass and refuses to overwrite an existing
file (see [Generator safety](#generator-safety)).

## Runtime commands

### `serve`

Start the HTTP server.

```bash
npm run keel serve
npm run keel serve --port 8080     # override the port
```

`serve` builds the [`HttpKernel`](./controllers.md) (reusing a container-bound
one if you've registered your own, otherwise constructing a fresh one), hands its
Hono app to `@hono/node-server`, and listens. On boot it prints:

```
⚓ Keel listening on http://localhost:3000
```

The port resolves in this order: the `--port` flag, then `config('app.port')`
(from the `APP_PORT` env var), then `3000`. The app name in the banner comes from
`config('app.name')`, defaulting to `Keel`. For a watch-mode dev server that
restarts on change, use `npm run dev` (which is `serve` under `tsx watch`).

### `routes`

List every registered route, its method(s), and its handler.

```bash
npm run keel routes
```

```
GET          /                        HomeController@index
GET          /users/:id               HomeController@show  (users.show)
GET|POST     /form                    Closure
GET          /favicon.ico             Static
```

Each row is `methods`, `path`, then the resolved handler. The handler column
reflects how the route was registered:

- **`Controller@method`** — a `[Controller, "method"]` handler tuple.
- **`Closure`** — an inline function handler.
- **`Static`** — a pre-built `Response` served directly.

A trailing `(name)` appears for [named routes](./routing.md). Multiple verbs on
one path are joined with `|`. If nothing is registered, it prints
`No routes registered.` instead.

## Generators

Each `make:*` command normalizes the name you give it and writes a single file.
Name normalization is suffix-aware and case-insensitive: it strips a trailing
suffix if present, PascalCases the base, then re-appends the canonical suffix.
So `Post`, `post`, and `PostController` all yield `PostController` — you can pass
whichever form reads naturally.

Generated stubs import their base classes and types from `@shaferllc/keel/core`
— the published package's core entry point — so they resolve out of the box in a
project that has `@shaferllc/keel` installed.

### `make:controller`

Generate a controller in `app/Controllers/`.

```bash
npm run keel make:controller Post
# -> app/Controllers/PostController.ts
```

The name is normalized: `Post`, `post`, and `PostController` all produce
`PostController`. The default stub is a single `index` action:

```ts
import type { Ctx } from "@shaferllc/keel/core";

export class PostController {
  index(c: Ctx) {
    return c.json({ controller: "PostController", action: "index" });
  }
}
```

Pass `-r` / `--resource` for a full RESTful resource controller with the seven
standard actions (`index`, `create`, `store`, `show`, `edit`, `update`,
`destroy`):

```bash
npm run keel make:controller Post --resource
# -> app/Controllers/PostController.ts
```

```ts
import type { Ctx } from "@shaferllc/keel/core";

export class PostController {
  index(c: Ctx) {
    return c.json({ action: "index" });
  }

  create(c: Ctx) {
    return c.json({ action: "create" });
  }

  // ...store, show, edit, update, destroy
}
```

Wire it up with `Route.resource(...)` — see [Controllers](./controllers.md).

### `make:provider`

Generate a service provider in `app/Providers/`.

```bash
npm run keel make:provider Billing
# -> app/Providers/BillingServiceProvider.ts
```

```ts
import { ServiceProvider } from "@shaferllc/keel/core";

export class BillingServiceProvider extends ServiceProvider {
  register(): void {
    // Bind services into the container here.
  }

  boot(): void {
    // Resolve and wire things up here.
  }
}
```

Remember to add it to `bootstrap/providers.ts` — generation doesn't register it
for you. See [Service Providers](./providers.md).

### `make:middleware`

Generate an HTTP middleware in `app/Http/Middleware/`.

```bash
npm run keel make:middleware Auth
# -> app/Http/Middleware/authMiddleware.ts
```

The class name is normalized to `AuthMiddleware`, but the **file** and the
exported constant are camelCased (`authMiddleware`). The stub is a Hono
`MiddlewareHandler` with before/after seams around `next()`:

```ts
import type { MiddlewareHandler } from "hono";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  // ...before
  await next();
  // ...after
};
```

This is the one stub that imports from `hono` rather than the Keel core. See
[Middleware](./middleware.md).

### `make:factory`

Generate a model factory in `database/factories/`.

```bash
npm run keel make:factory User
# -> database/factories/UserFactory.ts
```

`make:factory` takes a **model** name (no suffix stripped) and generates a
`<Model>Factory.ts`. The stub imports the model and exports a lowercase-named
factory built with the `factory()` helper:

```ts
import { factory } from "@shaferllc/keel/core";
import { User } from "../../app/Models/User.js";

export const userFactory = factory(User, (f) => ({
  // Describe one User's attributes; `f` is a Faker.
  name: f.name(),
  email: f.email(),
}));
```

It assumes a matching model at `app/Models/<Model>.ts` — create that first. See
[Factories & Seeders](./factories.md).

### `make:seeder`

Generate a database seeder in `database/seeders/`.

```bash
npm run keel make:seeder Database
# -> database/seeders/DatabaseSeeder.ts
```

```ts
import { Seeder } from "@shaferllc/keel/core";

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    // Populate the database, e.g.:
    // await userFactory.count(10).create();
  }
}
```

See [Factories & Seeders](./factories.md) for running them.

### `make:job`

Generate a queued job in `app/Jobs/`.

```bash
npm run keel make:job SendWelcome
# -> app/Jobs/SendWelcomeJob.ts
```

```ts
import { Job } from "@shaferllc/keel/core";

export class SendWelcomeJob extends Job {
  constructor(/* pass the data this job needs */) {
    super();
  }

  async handle(): Promise<void> {
    // Do the background work here.
  }
}
```

The `handle()` method holds the work; the constructor takes whatever data the
job needs to carry onto the queue. See [Queues & Jobs](./queues.md) for
dispatching them.

### `make:notification`

Generate a notification in `app/Notifications/`.

```bash
npm run keel make:notification InvoicePaid
# -> app/Notifications/InvoicePaidNotification.ts
```

```ts
import { Notification, type Notifiable, type MailContent } from "@shaferllc/keel/core";

export class InvoicePaidNotification extends Notification {
  via(_notifiable: Notifiable): string[] {
    return ["mail"];
  }

  toMail(_notifiable: Notifiable): MailContent {
    return {
      subject: "InvoicePaidNotification",
      text: "Notification body.",
    };
  }
}
```

`via()` returns the channels to deliver on; `toMail()` builds the message for the
mail channel. See [Notifications](./notifications.md) for sending them.

## Generator safety

Generators never clobber your work. Before writing, each one checks whether the
target file already exists; if it does, it prints an error, sets a non-zero exit
code, and writes nothing:

```
✗ Controller already exists: app/Controllers/PostController.ts
```

Only when the path is free does it create any missing parent directories and
write the stub, confirming with:

```
✓ Created Controller: app/Controllers/PostController.ts
```

Delete the existing file first if you truly mean to regenerate it.

## Adding your own commands

Commands are defined with [commander](https://github.com/tj/commander.js) in
[`src/core/cli/index.ts`](../src/core/cli/index.ts). Register a new one on the
`program`:

```ts
program
  .command("cache:clear")
  .description("Clear the application cache")
  .action(async () => {
    const app = await createApplication();
    // ...your logic, with full access to the container
  });
```

Because commands boot the application, they get the same container, config, and
providers your HTTP requests do.
