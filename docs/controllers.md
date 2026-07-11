# Controllers

Controllers are plain classes in `app/Controllers/`. Each public method is an
action bound to a route. They're resolved from the [container](./container.md),
so they get dependency injection and a fresh instance per request.

```ts
import type { Ctx } from "@shaferllc/keel/core";
import { json, param } from "@shaferllc/keel/core";

export class PostController {
  index() {
    return json({ posts: [] });
  }

  show() {
    return json({ id: param("id") });
  }
}
```

Bind actions in your routes with a `[Controller, method]` tuple:

```ts
router.get("/posts", [PostController, "index"]);
router.get("/posts/:id", [PostController, "show"]);
```

A controller action is just one of the [three handler forms](./routing.md#three-kinds-of-handler)
the router accepts — the array form. The other two (a closure, or a ready-made
`Response`) live inline on the route; controllers are for anything with enough
weight to earn its own class.

## The request context

Every action is called with the request [context](./request-response.md) as its
first argument — the `Ctx` type, which is Hono's `Context`. You can read from it
directly, or ignore it and reach for the ambient request helpers (`param`,
`query`, `body`) that resolve the current request from async-context storage.
Both styles work; pick whichever reads better.

```ts
import type { Ctx } from "@shaferllc/keel/core";
import { param } from "@shaferllc/keel/core";

export class PostController {
  // Take the context explicitly…
  show(c: Ctx) {
    return c.json({ id: c.req.param("id") });
  }

  // …or lean on the ambient helpers and drop the argument.
  edit() {
    return json({ id: param("id") });
  }
}
```

The context is what Keel hands the action under the hood — the router resolves
your controller from the container, then calls
`action.call(controller, c)`, so `this` is the controller instance and the sole
argument is the `Ctx`.

## Dependency injection

A controller's constructor receives the container, so it can resolve anything:

```ts
import type { Container, Ctx } from "@shaferllc/keel/core";
import { Mailer } from "../Services/Mailer.js";

export class UserController {
  constructor(private app: Container) {}

  store() {
    const mailer = this.app.make(Mailer);
    // …
  }
}
```

The container instantiates the controller with `new Controller(container)` — an
unbound class is auto-built, no registration needed. That happens **per
request**: each hit resolves a fresh instance, so it's safe to stash
request-scoped state on `this` without leaking it across requests.

If you'd rather inject specific services than the whole container, give the
controller a constructor that takes them and bind it in a
[service provider](./providers.md), pulling each dependency out of the container:

```ts
// InvoiceController's constructor takes a Mailer, not the container.
app.bind(InvoiceController, (c) => new InvoiceController(c.make(Mailer)));
```

## Single-action controllers

For a controller that does one thing, define a `handle` method and reference the
class with no method name:

```ts
export class PublishPost {
  handle() {
    return json({ published: true });
  }
}

router.post("/posts/:id/publish", [PublishPost]); // calls handle()
```

`[Controller]` and `[Controller, "handle"]` are equivalent — the method name
defaults to `"handle"` when the tuple has just one element. Referencing a method
the controller doesn't define throws at request time:
`Controller [PublishPost] has no method [handle].`

## Lazy-loaded controllers

Pass a `() => import(...)` loader instead of the class, and the controller is
only imported when its route is first hit — handy for large apps and cold
starts:

```ts
router.get("/reports", [() => import("../Controllers/ReportController.js"), "index"]);
```

The loader may resolve to a default export or the class itself — Keel unwraps
`.default` if present, otherwise uses the module value directly. Both work:

```ts
// default export
export default class ReportController { index() { /* … */ } }

// named export — point the loader at the property
router.get("/reports", [
  () => import("../Controllers/ReportController.js").then((m) => m.ReportController),
  "index",
]);
```

The loader must be an **arrow function** (or any function with no `prototype`).
Keel distinguishes an eager controller from a lazy loader by checking for a
`prototype` — classes have one, arrow functions don't — so a lazy controller
written as a `function` declaration would be mistaken for a class. Stick to
`() => import(...)`.

## Resource controllers

Generate a RESTful controller with all seven actions:

```bash
npm run keel make:controller Post --resource
```

That writes `app/Controllers/PostController.ts` with the conventional set —
`index`, `create`, `store`, `show`, `edit`, `update`, `destroy`:

```ts
import type { Ctx } from "@shaferllc/keel/core";

export class PostController {
  index(c: Ctx) { return c.json({ action: "index" }); }
  create(c: Ctx) { return c.json({ action: "create" }); }
  store(c: Ctx) { return c.json({ action: "store" }); }
  show(c: Ctx) { return c.json({ action: "show" }); }
  edit(c: Ctx) { return c.json({ action: "edit" }); }
  update(c: Ctx) { return c.json({ action: "update" }); }
  destroy(c: Ctx) { return c.json({ action: "destroy" }); }
}
```

Drop `--resource` (or `-r`) for a bare controller with a single `index` action.

Then wire the whole set up in one line (see [Routing → Resource routes](./routing.md#resource-routes)):

```ts
router.resource("posts", PostController);
router.resource("posts.comments", CommentController); // nested
router.resource("posts", PostController)
  .apiOnly()
  .as("articles")
  .params({ posts: "post" })
  .use(["store", "update", "destroy"], auth);
```

`router.resource` maps each of the seven route entries onto the matching
controller method by name — so a resource controller just needs methods with
those names. Trim the set with `.only()` / `.except()` / `.apiOnly()` when you
don't implement all seven.

## Related

- [Routing](./routing.md) — the `Router` methods (`get`, `post`, `resource`, …)
  that bind these controllers, plus closures and static-response handlers.
- [Container](./container.md) — how controllers (and their dependencies) are
  resolved and constructed.
- [Request & response](./request-response.md) — the `Ctx` object and the ambient
  `param` / `query` / `json` helpers actions use.

---

## API reference

Controllers are a usage pattern, not an exported API — you write the classes, and
the [`Router`](./routing.md) binds them. The two exported types you touch when
typing an action or a route are `Ctx` and `RouteHandler`, both from
`@shaferllc/keel/core`.

### Types

#### `Ctx`

`type Ctx = Context` (Hono's request `Context`)

The request context passed as the first argument to every route handler and
controller action. Read params/headers/body off it and build responses with it —
or ignore it and use the ambient request helpers.

```ts
import type { Ctx } from "@shaferllc/keel/core";

export class UserController {
  show(c: Ctx) {
    const id = c.req.param("id");        // route param
    const q = c.req.query("expand");     // query string
    return c.json({ id, expand: q });    // JSON response
  }
}
```

**Notes:** it's an alias for Hono's `Context`, so anything in Hono's context API
(`c.req`, `c.json`, `c.html`, `c.header`, `c.get`/`c.set`, `c.env`) is available.
An action may also take no argument and use `param()`/`query()`/`json()` instead,
which resolve the current request from async-context storage — see
[request & response](./request-response.md).

#### `RouteHandler`

`type RouteHandler = HandlerFn | ControllerAction | Response`

The union every `Router` verb accepts as its handler. A controller action is the
`ControllerAction` arm: `[Controller]`, `[Controller, "method"]`, or a lazy
`[() => import(...), "method"]`.

```ts
import type { RouteHandler } from "@shaferllc/keel/core";
import { json } from "@shaferllc/keel/core";

// each arm of the union is a valid handler
const closure: RouteHandler = () => json({ ok: true });
const staticResp: RouteHandler = json({ status: "ok" });
const action: RouteHandler = [UserController, "show"];
const single: RouteHandler = [PublishPost];               // calls handle()
const lazy: RouteHandler = [
  () => import("../Controllers/ReportController.js"),
  "index",
];
```

**Notes:** the constituent types (`HandlerFn`, `ControllerAction`,
`ControllerRef`, `LazyController`) are internal to the router and not exported —
annotate values as `RouteHandler` when you need an explicit type. The router
turns any of these into an executable function at boot; a controller arm is
resolved from the container per request. For the verbs that consume a
`RouteHandler` (`get`, `post`, `put`, `patch`, `delete`, `any`, `route`,
`resource`, …), see [Routing → API reference](./routing.md#api-reference).
