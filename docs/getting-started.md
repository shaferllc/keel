# Getting Started

Keel is a house framework for Node.js — a small, legible MVC layer over
[Hono](./hono.md). This guide is a guided first hour: install it, stand up a
route, a controller, and a view, read some config, drive the console, and know
where to go next.

## Requirements

- Node.js **≥ 22**
- npm (ships with Node)

Keel targets modern Node and web-standard APIs, so a current runtime matters —
`22` is the floor.

## Install

Keel ships as two repos: the **framework** (`@shaferllc/keel`, published to
npm) and a **starter app** (`shaferllc/keel-app`) you build on. Which path you
take depends on whether you're starting fresh or bolting Keel onto something
that already exists. See [Architecture](./architecture.md#two-repos-library-and-starter)
for why it's split this way.

### From the starter (recommended)

The fastest route to a running app is the starter — a working skeleton with the
folders, config, and scripts already wired:

```bash
git clone https://github.com/shaferllc/keel-app.git my-app
cd my-app
npm install
```

The starter depends on `@shaferllc/keel`, so you pick up framework updates with
an ordinary `npm update @shaferllc/keel` — your app code in `app/` stays put.

A fresh checkout ships with a working `.env`. To start from the template
instead:

```bash
cp .env.example .env
```

### Into an existing app

Already have a Node project? Add the package:

```bash
npm install @shaferllc/keel
```

Everything Keel exposes comes from one entry point:

```ts
import { Application, Router, config } from "@shaferllc/keel/core";
```

You supply the four convention folders yourself — `app/`, `config/`, `routes/`,
`bootstrap/` — plus an entry that calls `createApplication()`. The starter's
`bootstrap/app.ts` is the reference; copy it and trim to taste.

### Hacking on the framework itself

To work on Keel proper, clone the framework repo — it carries an example app you
can run directly:

```bash
git clone https://github.com/shaferllc/keel.git
cd keel
npm install
npm run dev        # example app on http://localhost:3000
npm run build      # compile the package to dist/
```

## Run the server

```bash
npm run dev        # tsx watch — restarts on change
# or
npm run serve      # one-shot
```

You should see:

```
⚓ Keel listening on http://localhost:3000
```

Hit the sample routes the starter ships with:

```bash
curl localhost:3000/            # {"framework":"Keel", ...}
curl localhost:3000/ping        # {"pong":true}
curl localhost:3000/hello/Tom   # Hello, Tom!
```

## Your first route

Routes live in `routes/web.ts`. The simplest is a **closure** — a function that
takes the request context `c` and returns a response:

```ts
router.get("/status", (c) => c.json({ ok: true, time: Date.now() }));
```

Save — `tsx watch` reloads — and visit `http://localhost:3000/status`.

A route handler can be a closure, a `[Controller, method]` tuple, or even a
ready-made `Response`. Closures are perfect for one-liners; reach for a
controller once there's real logic to house. Parameters come off the path with a
leading colon:

```ts
router.get("/greet/:name", (c) => c.text(`Ahoy, ${c.req.param("name")}!`));
```

You don't have to thread `c` everywhere, either — Keel's [request
helpers](./request-response.md) reach the active request from anywhere, so the
same route reads:

```ts
import { text, param } from "@shaferllc/keel/core";

router.get("/greet/:name", () => text(`Ahoy, ${param("name")}!`));
```

See [Routing](./routing.md) for names, groups, resource routes, param
constraints, and URL generation.

## Your first controller

Once a handler grows past a line or two, move it into a controller. Generate one
with the console:

```bash
npm run keel make:controller Task
```

That writes `app/Controllers/TaskController.ts`:

```ts
import type { Ctx } from "@shaferllc/keel/core";

export class TaskController {
  index(c: Ctx) {
    return c.json({ controller: "TaskController", action: "index" });
  }
}
```

Wire it up in `routes/web.ts` with a `[Controller, method]` tuple. Keel resolves
the controller **out of the container**, so its constructor gets dependency
injection for free:

```ts
import { TaskController } from "../app/Controllers/TaskController.js";

router.get("/tasks", [TaskController, "index"]);
```

Confirm it's registered:

```bash
npm run keel routes
```

```
GET    /tasks                   TaskController@index
```

Add more actions as plain methods, and give related routes their REST shape in
one call with `router.resource("tasks", TaskController)`. [Controllers](./controllers.md)
covers single-action controllers, lazy-loaded controllers, and how DI reaches
the constructor.

## Your first view

Keel views are [Hono JSX](./hono.md) components — plain functions that return
markup. They live by convention in `resources/views/`. Create
`resources/views/tasks.tsx`:

```tsx
// @jsxImportSource hono/jsx
import type { FC } from "hono/jsx";

export const TasksPage: FC<{ count: number }> = ({ count }) => (
  <main>
    <h1>⚓ Tasks</h1>
    <p>You have {count} task(s) aboard.</p>
  </main>
);
```

Render it from the controller with the `view()` helper — it renders the
component to a full HTML document and type-checks the props against the
component:

```ts
import type { Ctx } from "@shaferllc/keel/core";
import { view } from "@shaferllc/keel/core";
import { TasksPage } from "../../resources/views/tasks.js";

export class TaskController {
  index(c: Ctx) {
    return view(TasksPage, { count: 3 });
  }
}
```

Note the `.js` import specifier for a `.tsx` file — that's the Node ESM
convention, and it's correct even though the file on disk is TypeScript. See
[Views](./views.md) for layouts, async components, and streaming.

## Configuration

Config files live in `config/` and each exports a default object. They're loaded
at boot under their filename, so `config/app.ts` is reachable as `config('app.*')`:

```ts
// config/app.ts
import { env } from "@shaferllc/keel/core";

export default {
  name: env("APP_NAME", "Keel"),
  env: env("APP_ENV", "local"),
  debug: env("APP_DEBUG", true),
  url: env("APP_URL", "http://localhost:3000"),
  port: env("APP_PORT", 3000),
};
```

`env()` reads a variable from `.env` (loaded at boot) with a typed fallback — it
coerces `"true"`/`"false"` to booleans and numeric strings to numbers when the
fallback is a number. Read config anywhere with the `config()` helper, using dot
notation and an optional fallback:

```ts
import { config } from "@shaferllc/keel/core";

config("app.name");            // "Keel"
config("app.port", 3000);      // number, with a fallback
```

Add a new config file by dropping it in `config/` — `config/mail.ts` becomes
`config('mail.*')` with no wiring. [Configuration](./configuration.md) has the
full story.

## The console

The `keel` console drives the app from the command line. In the starter, run it
through npm:

```bash
npm run keel routes                 # list every registered route
npm run keel serve --port 8080      # start the server on a chosen port
npm run keel make:controller Post   # -> app/Controllers/PostController.ts
npm run keel make:provider Billing  # -> app/Providers/BillingServiceProvider.ts
npm run keel make:middleware Auth   # -> app/Http/Middleware/authMiddleware.ts
```

The `make:*` generators scaffold from the same stubs the framework uses, so
generated files are wired to the right folders and import from
`@shaferllc/keel/core`. `keel routes` is your map — run it whenever you're
unsure what's mounted. [The Console](./console.md) lists every command.

## Where to go next

You now have the shape of a Keel app: routes point at controllers, controllers
render views and read config, and the console scaffolds the pieces. The deep
guides pick up from here:

- [Architecture](./architecture.md) — how boot, the container, and the request
  lifecycle fit together
- [The Service Container](./container.md) — how dependency injection works
- [Service Providers](./providers.md) — where you register your own services
- [Routing](./routing.md) — parameters, names, groups, resources, URLs
- [Controllers](./controllers.md) — actions, DI, single-action controllers
- [Views](./views.md) — JSX components, layouts, streaming
- [Middleware](./middleware.md) — global and per-route request filters
- [Request & Response](./request-response.md) — the helpers that reach the
  active request
- [Database](./database.md) and [Models](./models.md) — the query builder and
  the active-record layer on top of it
- [Configuration](./configuration.md) and [The Console](./console.md) — settings
  and commands

When something isn't documented, open the source — the whole framework is a few
hundred readable lines in `src/core/`, and [Built on Hono](./hono.md) explains
what you inherit from the layer underneath.
