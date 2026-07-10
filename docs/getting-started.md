# Getting Started

Keel is a Laravel-flavored house framework for Node.js. This guide gets you from
a fresh clone to your first route and controller.

## Requirements

- Node.js **≥ 22**
- npm (ships with Node)

## Install

```bash
git clone https://github.com/shaferllc/keel.git
cd keel
npm install
```

Keel ships with a working `.env`. To start from the template instead:

```bash
cp .env.example .env
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

Hit the sample routes:

```bash
curl localhost:3000/            # {"framework":"Keel", ...}
curl localhost:3000/ping        # {"pong":true}
curl localhost:3000/hello/Tom   # Hello, Tom!
```

## Your first route

Open `routes/web.ts` and add a closure route:

```ts
router.get("/status", (c) => c.json({ ok: true, time: Date.now() }));
```

Save — `tsx watch` reloads — and visit `http://localhost:3000/status`.

## Your first controller

Generate one with the console:

```bash
npm run keel make:controller Task
```

That writes `app/Controllers/TaskController.ts`:

```ts
import type { Ctx } from "@keel/core";

export class TaskController {
  index(c: Ctx) {
    return c.json({ controller: "TaskController", action: "index" });
  }
}
```

Wire it up in `routes/web.ts` with a `[Controller, method]` tuple — Keel
resolves the controller out of the container, so it gets dependency injection:

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

## Next steps

- [The Service Container](./container.md) — how dependency injection works
- [Routing](./routing.md) — parameters, closures, controller actions
- [The Console](./console.md) — every `keel` command
