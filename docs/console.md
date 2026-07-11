# The Console

Keel ships with a console for running the server and
generating code. The binary is `bin/keel.ts`; npm scripts wrap it with `tsx`.

```bash
npm run keel <command> [args]
# e.g.
npm run keel routes
```

You can also invoke it directly: `npx tsx bin/keel.ts <command>`.

## Commands

### `serve`

Start the HTTP server.

```bash
npm run keel serve
npm run keel serve --port 8080     # override the port
```

The port defaults to `config('app.port')` (from `APP_PORT`). For a watch-mode
dev server, use `npm run dev`.

### `routes`

List every registered route, its method, and its handler.

```bash
npm run keel routes
```

```
GET    /                        HomeController@index
GET    /users/:id               HomeController@show
GET    /ping                    Closure
```

### `make:controller`

Generate a controller in `app/Controllers/`.

```bash
npm run keel make:controller Post
# -> app/Controllers/PostController.ts
```

The name is normalized: `Post`, `post`, and `PostController` all produce
`PostController`.

### `make:provider`

Generate a service provider in `app/Providers/`.

```bash
npm run keel make:provider Billing
# -> app/Providers/BillingServiceProvider.ts
```

Remember to add it to `bootstrap/providers.ts`.

### `make:middleware`

Generate an HTTP middleware in `app/Http/Middleware/`.

```bash
npm run keel make:middleware Auth
# -> app/Http/Middleware/authMiddleware.ts
```

### `make:factory`

Generate a model factory in `database/factories/`.

```bash
npm run keel make:factory User
# -> database/factories/UserFactory.ts
```

### `make:seeder`

Generate a database seeder in `database/seeders/`.

```bash
npm run keel make:seeder Database
# -> database/seeders/DatabaseSeeder.ts
```

See [Factories & Seeders](./factories.md) for using them.

### `make:job`

Generate a queued job in `app/Jobs/`.

```bash
npm run keel make:job SendWelcome
# -> app/Jobs/SendWelcomeJob.ts
```

See [Queues & Jobs](./queues.md) for dispatching them.

### `make:notification`

Generate a notification in `app/Notifications/`.

```bash
npm run keel make:notification InvoicePaid
# -> app/Notifications/InvoicePaidNotification.ts
```

See [Notifications](./notifications.md) for sending them.

## Generator safety

Generators refuse to overwrite an existing file and exit non-zero:

```
✗ Controller already exists: app/Controllers/PostController.ts
```

Delete the file first if you truly mean to regenerate it.

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
