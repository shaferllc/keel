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
| `make:transformer` | `<name>` `[-m <model>]` | `app/Transformers/<Name>Transformer.ts` |
| `mcp` | — | Start the [MCP server](./ai.md) for AI agents (stdio) |

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

### `mcp`

Start the Model Context Protocol server over stdio, exposing Keel's docs, public
API, and generators to AI agents:

```bash
npm run keel mcp        # or the shipped `keel-mcp` bin in a consuming app
```

See [Building with AI](./ai.md) for how to connect it to Claude Code, Cursor, or
any MCP client, and the tools it provides.

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

## Your console entry point

The console ships in the package, and takes your application factory:

```ts
#!/usr/bin/env tsx
// bin/keel.ts
import { run } from "@shaferllc/keel/cli";
import { createApplication } from "../bootstrap/app.js";

run(process.argv, { createApplication }).catch((error) => {
  console.error(error);
  process.exit(1);
});
```

It's handed `createApplication` rather than importing it, because a framework that
imports an *application* has its dependency pointing the wrong way — and that one
import is what kept the console out of the published build until now.

Commands that need the app (`serve`, `routes`, `migrate`) boot it once and share it.
Scaffolding commands (`make:*`) don't, so a boot failure isn't fatal — it's surfaced
only when a command that actually needs the app runs.

## Writing your own commands

`keel make:command greet` scaffolds `app/Commands/greet.ts`. Everything in
`app/Commands` is discovered automatically — no registration step.

```ts
import { defineCommand, arg, flag } from "@shaferllc/keel/core";

export const greet = defineCommand({
  name: "greet",
  description: "Greet someone",

  args: { name: arg.string({ description: "who to greet" }) },
  flags: { loud: flag.boolean({ alias: "l", description: "SHOUT IT" }) },

  async run({ args, flags, ui }) {
    const message = `Hello, ${args.name}!`;
    ui.success(flags.loud ? message.toUpperCase() : message);
  },
});
```

```bash
keel greet Ada --loud     # ✔ HELLO, ADA!
keel greet --help         # generated usage, args, and options
```

**`args.name` is a `string` and `flags.loud` is a `boolean` — inferred, not cast.**
That's the point of declaring them: the parsing is generated from the types, so the
two can't drift apart. Make an arg optional and its type becomes
`string | undefined`; give it a default and it's a `string` again.

Commands run with the application booted, so they get the same container, config,
and providers your HTTP requests do.

### Arguments

Positional, in declaration order. Required by default.

| Builder | Value |
|---------|-------|
| `arg.string()` | `string` |
| `arg.number()` | `number` — rejected with a clear error if it isn't one |
| `arg.spread()` | `string[]` — swallows the rest; must be last |

Options: `description`, `required: false`, `default`, `parse`.

### Flags

| Builder | Value |
|---------|-------|
| `flag.boolean()` | `boolean` — defaults to `false`, so it's never `undefined` |
| `flag.string()` | `string \| undefined` |
| `flag.number()` | `number \| undefined` |
| `flag.array()` | `string[]` — repeatable, defaults to `[]` |

Options: `description`, `alias` (a single letter), `required`, `default`, `parse`.

The parser understands `--flag value`, `--flag=value`, `--no-flag`, `-f value`,
bundled shorthands (`-lt 5`), and `--`, after which everything is passed through
untouched in `rest`.

An **unknown flag is an error**, not a shrug — a typo'd `--forse` should tell you,
not silently do nothing. Set `allowUnknownFlags: true` if a command genuinely needs
to pass flags on to something else.

### Exit codes

Return a number to set the exit code; return nothing for `0`. A thrown error is
caught, reported, and exits `1` — a console is a bad place to show a user a stack
trace because they mistyped a flag. A **usage** error (missing arg, bad flag) prints
what's wrong *and the command's help*.

## Terminal UI

Every command gets a `ui`:

```ts
ui.info("Checking…");
ui.success("Migrated 3 tables");
ui.warning("Nothing to do");
ui.error("Failed"); // stderr
ui.debug("verbose detail");

ui.action("create", "app/Models/User.ts"); // CREATE  app/Models/User.ts
ui.action("skip", "app/Models/Post.ts", "skipped");

ui.table(["Name", "Rows"]).row(["users", "42"]).row(["orgs", "7"]).render();

ui.sticker(["http://localhost:3000"], "Server running");
ui.instructions(["cd my-app", "npm install", "keel serve"], "Next steps");

ui.colors("green", "done"); // paint a string yourself
```

### Tasks

For a command that does several things in a row:

```ts
await ui
  .tasks()
  .add("Install dependencies", async (task) => {
    task.update("resolving…");
    return "42 packages";
  })
  .add("Run migrations", async () => "3 tables")
  .run();
```

It **stops at the first failure**, because the tasks after it almost certainly
depended on it and a cascade of red tells you nothing new. `run()` resolves to
`false` if anything failed.

## Prompts

```ts
const name = await prompt.ask("Project name?", { default: "my-app" });
const secret = await prompt.secure("API key?");
const ok = await prompt.confirm("Delete everything?");
const driver = await prompt.choice("Database?", ["sqlite", "postgres"]);
const features = await prompt.multiple("Features?", ["auth", "queue", "mail"]);
```

`ask` re-asks on a failed `validate` rather than dying — a typo shouldn't cost
someone the whole command. Every prompt takes `default`, `hint`, `validate`, and
`result`.

## Testing a command

A command that asks questions is normally a command you can't test. So prompts can
be **trapped**: script the answers up front, and nothing touches the terminal.

```ts
import { ConsoleKernel, createUi, createPrompt } from "@shaferllc/keel/core";

const ui = createUi({ raw: true }); // buffer the output, drop the colors
const prompt = createPrompt({ trap: true });
const kernel = new ConsoleKernel({ ui, prompt }).register(setup);

prompt.trap("Project name?").replyWith("keel-app");
prompt.trap("Database?").chooseOption(1);
prompt.trap("Write the config?").accept();

const code = await kernel.run(["setup"]);

assert.equal(code, 0);
assert.match(ui.logs.join("\n"), /keel-app on postgres/);
prompt.assertAllTrapsUsed(); // every scripted question was actually asked
```

An **untrapped prompt throws** instead of hanging. That matters more than it
sounds: without it, the test would block forever on stdin no test will ever
provide, and your suite would simply stop — with no failure to read.

A trap can also assert the prompt's own validation:

```ts
prompt
  .trap("Email?")
  .assertFails("", "Email is required")
  .assertPasses("ada@example.com")
  .replyWith("ada@example.com");
```

`ui.logs` and `ui.errors` hold every line written, colorless, so you can assert on
exactly what the command said.

## The REPL

```bash
keel repl
```

An interactive shell with the **application booted** — the container is up, the
providers have run, and the helpers are in scope:

```
keel > await db("users").where("active", 1).get()
keel > make(Router).all()
keel > await cache().get("stats")
keel > .ls        # what's in scope
keel > .exit
```

Poking at a model in a REPL is the fastest debugging loop there is, and it
shouldn't cost you a throwaway script to get one. History persists in
`.keel_repl_history`.

---

## A note on the built-ins

The commands *above* (`serve`, `routes`, `make:*`, `migrate:*`) still run through
Keel's original console wrapper, and package-contributed commands do too. Your
commands — anything in `app/Commands` — run on the system documented here, and take
precedence over a built-in of the same name. Migrating the built-ins across is
mechanical and will happen; nothing about the API here changes when it does.
